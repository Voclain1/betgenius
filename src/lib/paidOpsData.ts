import { prisma } from "@/lib/prisma";
import { lagosDateKey, lagosDayBounds } from "@/lib/lagosDate";
import { JOB_GENERATE_VIP_PREMIUM } from "@/lib/jobRuns";
import { PAID_ANY_LEAGUE_IDS, readVipPremiumAttempt, attemptKickoffDay } from "@/lib/vipPremiumOverlay";
import { PREMIUM_GENERATED_PROVENANCE, VIP_GENERATED_PROVENANCE } from "@/lib/paidOnly";
import { classifyPaidDay, maxGapMinutes, type PaidDayInputs, type PaidDayStatus } from "@/lib/paidOps";
import { JOB_PAID_SELECTION_SHADOW } from "@/lib/vipPremiumPipeline";

/**
 * The paid-feed operations picture for recent Lagos kickoff days, read from the
 * tables the pipeline already writes: the generation ledger, the odds cache,
 * the dedicated pass's AIJobs and JobRuns, the predictions and their paid tags,
 * and the shadow log. READ-ONLY.
 *
 * Used by /admin/paid-ops, by the alert in the settle route, and by
 * scripts/verify-paid-production.ts, so all three classify a day identically.
 */
export type PaidOpsDay = PaidDayInputs & { status: PaidDayStatus; reasons: string[]; premiumPicks: number; shadowRuns: number };

export type PaidOpsSnapshot = {
  days: PaidOpsDay[];
  settlementBacklog: { pendingOver6h: number; manualOnly: number; oldest: string | null };
  shadow: { last24h: number; lastAt: string | null; lastSummary: string | null; fallbacks: Record<string, number>; modes: Record<string, number> };
  paidPassLast24h: { runs: number; failedRuns: number; lastAt: string | null };
};

const DAY_MS = 86_400_000;

export async function loadPaidOpsSnapshot(days = 14, now: Date = new Date()): Promise<PaidOpsSnapshot> {
  const first = lagosDayBounds(-(days - 1), now).start;
  const last = lagosDayBounds(0, now).end;
  const [ledger, preds, jobs, runs, shadowRuns, pendingRows] = await Promise.all([
    prisma.generationAttempt.findMany({ where: { kickoff: { gte: first, lt: last } }, select: { matchKey: true, leagueApiId: true, kickoff: true, status: true } }),
    prisma.prediction.findMany({
      where: { kickoff: { gte: first, lt: last }, status: { in: ["PUBLISHED", "PENDING_REVIEW"] } },
      select: { kickoff: true, status: true, provenance: true, categories: { select: { category: true } } },
    }),
    prisma.aIJob.findMany({ where: { createdAt: { gte: new Date(first.getTime() - 3 * DAY_MS) }, prompt: { contains: '"intent":"VIP_PREMIUM"' } }, select: { prompt: true, createdAt: true } }),
    prisma.jobRun.findMany({ where: { job: JOB_GENERATE_VIP_PREMIUM, ranAt: { gte: new Date(first.getTime() - 2 * DAY_MS) } }, select: { ranAt: true, ok: true, detail: true } }),
    prisma.jobRun.findMany({ where: { job: JOB_PAID_SELECTION_SHADOW, ranAt: { gte: first } }, select: { ranAt: true, summary: true, detail: true }, orderBy: { ranAt: "desc" } }),
    prisma.prediction.findMany({ where: { status: "PUBLISHED", outcome: "PENDING", kickoff: { lt: new Date(now.getTime() - 6 * 3_600_000) } }, select: { kickoff: true, manualSettlementOnly: true }, orderBy: { kickoff: "asc" } }),
  ]);
  const keys = [...new Set(ledger.filter((l) => l.status === "SUCCEEDED" && PAID_ANY_LEAGUE_IDS.includes(l.leagueApiId ?? -1)).map((l) => l.matchKey))];
  const quotes = keys.length ? await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys } }, select: { matchKey: true, fetchedAt: true } }) : [];
  const quoted = new Map(quotes.map((q) => [q.matchKey, q.fetchedAt]));

  const errorsByDay = new Map<string, number>();
  for (const r of runs) {
    const results = ((r.detail as any)?.results ?? []) as Array<{ kickoff?: string; ok?: boolean }>;
    for (const x of results) if (x.ok === false && x.kickoff) errorsByDay.set(lagosDateKey(new Date(x.kickoff)), (errorsByDay.get(lagosDateKey(new Date(x.kickoff))) ?? 0) + 1);
  }
  const attemptsByDay = new Map<string, number>();
  for (const j of jobs) {
    const a = readVipPremiumAttempt(j.prompt, j.createdAt);
    if (a) attemptsByDay.set(attemptKickoffDay(a), (attemptsByDay.get(attemptKickoffDay(a)) ?? 0) + 1);
  }

  const out: PaidOpsDay[] = [];
  for (let off = -(days - 1); off <= 0; off++) {
    const { start, end } = lagosDayBounds(off, now);
    const day = lagosDateKey(start);
    const inDay = (d: Date | null) => !!d && d >= start && d < end;
    const lg = ledger.filter((l) => inDay(l.kickoff));
    const covered = lg.filter((l) => l.status === "SUCCEEDED");
    const scope = covered.filter((l) => PAID_ANY_LEAGUE_IDS.includes(l.leagueApiId ?? -1));
    const ps = preds.filter((p) => inDay(p.kickoff));
    const dedicated = ps.filter((p) => p.provenance === VIP_GENERATED_PROVENANCE || p.provenance === PREMIUM_GENERATED_PROVENANCE);
    const published = ps.filter((p) => p.status === "PUBLISHED");
    // The pass works up to ~48h ahead of a kickoff: its runs in the 36h before
    // the day ends are the ones that mattered for it. Gaps are judged up to now.
    const runFrom = new Date(start.getTime() - 36 * 3_600_000);
    const runTo = new Date(Math.min(end.getTime(), now.getTime()));
    const inputs: PaidDayInputs = {
      day,
      discovered: lg.length,
      covered: covered.length,
      failed: lg.filter((l) => l.status === "FAILED" || l.status === "ABANDONED").length,
      paidScope: scope.length,
      paidScopePriced: scope.filter((l) => { const f = quoted.get(l.matchKey); return !!f && f < l.kickoff; }).length,
      attempts: attemptsByDay.get(day) ?? 0,
      attemptErrors: errorsByDay.get(day) ?? 0,
      // Promoted and still unpublished only counts once kickoff has passed: before
      // that it may still publish on a later run.
      promoted: dedicated.filter((p) => p.status === "PUBLISHED" || (p.kickoff && p.kickoff < now)).length,
      published: dedicated.filter((p) => p.status === "PUBLISHED").length,
      maxRunGapMinutes: runs.length ? maxGapMinutes(runs.map((r) => r.ranAt), runFrom, runTo) : null,
      vipPicks: published.filter((p) => p.categories.some((c) => c.category === "VIP")).length,
    };
    const c = classifyPaidDay(inputs);
    out.push({
      ...inputs, ...c,
      premiumPicks: published.filter((p) => p.categories.some((c2) => c2.category === "PREMIUM")).length,
      shadowRuns: shadowRuns.filter((s) => (s.detail as any)?.day === day).length,
    });
  }

  const recentShadow = shadowRuns.filter((s) => now.getTime() - s.ranAt.getTime() <= DAY_MS);
  const tally = (f: (d: any) => string | null) => recentShadow.reduce<Record<string, number>>((m, s) => { const k = f(s.detail); if (k) m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const recentRuns = runs.filter((r) => now.getTime() - r.ranAt.getTime() <= DAY_MS);
  return {
    days: out,
    settlementBacklog: {
      pendingOver6h: pendingRows.length,
      manualOnly: pendingRows.filter((p) => p.manualSettlementOnly).length,
      oldest: pendingRows[0]?.kickoff?.toISOString() ?? null,
    },
    shadow: {
      last24h: recentShadow.length,
      lastAt: shadowRuns[0]?.ranAt.toISOString() ?? null,
      lastSummary: shadowRuns[0]?.summary ?? null,
      fallbacks: tally((d) => d?.fallback ?? null),
      modes: tally((d) => (d?.mode ? `${d.mode}/${d.live}` : null)),
    },
    paidPassLast24h: {
      runs: recentRuns.length,
      failedRuns: recentRuns.filter((r) => !r.ok).length,
      lastAt: runs.length ? runs.reduce((a, b) => (a.ranAt > b.ranAt ? a : b)).ranAt.toISOString() : null,
    },
  };
}

