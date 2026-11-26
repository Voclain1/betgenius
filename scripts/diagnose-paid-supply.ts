/**
 * READ-ONLY diagnosis: why are there no VIP / Premium predictions for the
 * coming days? Aggregates and job summaries only (the repository is public):
 * no reasoning text, no user data. No provider or model calls.
 *
 *   REQUIRE_READ_ONLY=1 npx tsx scripts/diagnose-paid-supply.ts
 */
import { PrismaClient } from "@prisma/client";
import { lagosDateKey } from "../src/lib/lagosDate";
import { DEDICATED_PAID_PROVENANCES } from "../src/lib/geniusCuration";
import { PAID_CORE_LEAGUE_IDS, PAID_ANY_LEAGUE_IDS, VIP_PREMIUM_BACKOFF_LOCK_PREFIX } from "../src/lib/vipPremiumOverlay";

const db = new PrismaClient();
const H = 3_600_000, D = 24 * H;
const out = (section: string, data: unknown) => console.log(JSON.stringify({ section, ...(data as object) }));
const count = <T,>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((o, x) => { const k = key(x); o[k] = (o[k] ?? 0) + 1; return o; }, {});

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [r] = await db.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (r?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
  }
  const now = new Date();
  out("now", { at: now.toISOString(), lagosDay: lagosDateKey(now) });

  // 1. Paid rows by kickoff day (Lagos), last 10 days and next 4.
  const paid = await db.prediction.findMany({
    where: { kickoff: { gte: new Date(+now - 10 * D), lte: new Date(+now + 4 * D) }, categories: { some: { category: { in: ["VIP", "PREMIUM"] } } } },
    select: { status: true, provenance: true, kickoff: true, publishedAt: true, createdAt: true, categories: { select: { category: true } } },
  });
  const byDay: Record<string, Record<string, number>> = {};
  for (const p of paid) {
    const day = lagosDateKey(p.kickoff!);
    for (const c of p.categories.filter((c) => c.category === "VIP" || c.category === "PREMIUM")) {
      const k = `${c.category}:${p.status}`;
      (byDay[day] ??= {})[k] = (byDay[day][k] ?? 0) + 1;
    }
  }
  out("paidRowsByKickoffDay", { byDay: Object.fromEntries(Object.entries(byDay).sort()) });
  out("paidRowsByProvenance", { provenance: count(paid, (p) => `${p.provenance}:${p.status}`) });
  const lastPaidPublished = await db.prediction.findFirst({ where: { status: "PUBLISHED", categories: { some: { category: { in: ["VIP", "PREMIUM"] } } } }, orderBy: { publishedAt: "desc" }, select: { publishedAt: true, kickoff: true, provenance: true } });
  out("lastPaidPublished", { lastPaidPublished });

  // 2. Available games: fixtures and ordinary rows ahead, by day, paid leagues vs all.
  const fixtures = (await db.fixture.findMany({ where: { kickoff: { gte: now, lte: new Date(+now + 4 * D) } }, select: { kickoff: true, status: true, league: { select: { apiId: true } } } })).map((f) => ({ kickoff: f.kickoff, status: f.status, leagueApiId: f.league.apiId as number | null }));
  const core = new Set(PAID_CORE_LEAGUE_IDS), any = new Set(PAID_ANY_LEAGUE_IDS);
  const fx: Record<string, { all: number; core: number; widened: number }> = {};
  for (const f of fixtures) { const d = (fx[lagosDateKey(f.kickoff)] ??= { all: 0, core: 0, widened: 0 }); d.all++; if (f.leagueApiId != null && core.has(f.leagueApiId)) d.core++; else if (f.leagueApiId != null && any.has(f.leagueApiId)) d.widened++; }
  out("fixturesAhead", { byDay: Object.fromEntries(Object.entries(fx).sort()) });
  const rowsAhead = await db.prediction.findMany({ where: { kickoff: { gte: now, lte: new Date(+now + 4 * D) }, marketType: { not: "SAME_GAME_DOUBLE" } }, select: { kickoff: true, status: true, provenance: true, leagueApiId: true, confidence: true } });
  const ra: Record<string, Record<string, number>> = {};
  for (const r of rowsAhead) { const d = (ra[lagosDateKey(r.kickoff!)] ??= {}); const k = `${r.provenance}:${r.status}${r.leagueApiId != null && core.has(r.leagueApiId) ? ":core" : ""}`; d[k] = (d[k] ?? 0) + 1; }
  out("predictionRowsAhead", { byDay: Object.fromEntries(Object.entries(ra).sort()) });
  const ledger = await db.generationAttempt.findMany({ where: { kickoff: { gte: now, lte: new Date(+now + 4 * D) } }, select: { kickoff: true, status: true, leagueApiId: true } }).catch(() => [] as Array<{ kickoff: Date | null; status: string; leagueApiId: number | null }>);
  out("generationLedgerAhead", { byDayStatus: count(ledger, (l) => `${l.kickoff ? lagosDateKey(l.kickoff) : "?"}:${l.status}${l.leagueApiId != null && core.has(l.leagueApiId) ? ":core" : ""}`) });

  // 3. Dedicated paid generation jobs.
  const jobs = await db.aIJob.findMany({ where: { createdAt: { gte: new Date(+now - 7 * D) }, prompt: { contains: '"intent":"VIP_PREMIUM"' } }, select: { createdAt: true, status: true } });
  out("vipPremiumModelJobs", { byDayStatus: count(jobs, (j) => `${lagosDateKey(j.createdAt)}:${j.status}`) });

  // 4. Scheduled job runs: did the paid pass fire, and what did it say?
  for (const job of ["generate-vip-premium", "paid-selection-shadow", "generate-ordinary", "refresh-odds", "curate-accumulators", "early-free-generation"]) {
    const runs = await db.jobRun.findMany({ where: { job, ranAt: { gte: new Date(+now - 4 * D) } }, orderBy: { ranAt: "desc" }, select: { ranAt: true, ok: true, summary: true, ms: true } });
    out("jobRuns", { job, runs: runs.length, failed: runs.filter((r) => !r.ok).length, perDay: count(runs, (r) => lagosDateKey(r.ranAt)),
      summaries: count(runs, (r) => (r.summary ?? "").replace(/\d+/g, "#").slice(0, 220)),
      latest: runs.slice(0, job === "generate-vip-premium" ? 12 : 3).map((r) => ({ at: r.ranAt.toISOString(), ok: r.ok, ms: r.ms, summary: (r.summary ?? "").slice(0, 400) })) });
  }
  const lastVip = await db.jobRun.findMany({ where: { job: "generate-vip-premium" }, orderBy: { ranAt: "desc" }, take: 6, select: { ranAt: true, detail: true } });
  for (const r of lastVip) {
    const d = (r.detail ?? {}) as Record<string, unknown>;
    const v = (d.vipPremium ?? {}) as Record<string, unknown>;
    out("vipRunDetail", { at: r.ranAt.toISOString(), ok: d.ok, reason: d.reason, skipped: d.skipped, claimed: d.claimed, succeeded: d.succeeded, failed: d.failed, predictionsCreated: d.predictionsCreated,
      operationalCompletion: d.operationalCompletion,
      overlay: { stoodDown: v.stoodDown, considered: v.considered, inScope: v.inScope, widened: v.widened, coreFixtures: v.coreFixtures, oddsCalls: v.oddsCalls, freshlyPriced: v.freshlyPriced, qualified: v.qualified,
        skipped: v.skipped, oddsSkipped: v.oddsSkipped, warmSkips: Array.isArray(v.warmBandSkips) ? count(v.warmBandSkips as Array<{ reason: string }>, (s) => s.reason) : undefined,
        rejectedReasons: v.rejectedReasons, published: v.published, publishHeldN: Array.isArray(v.publishHeld) ? v.publishHeld.length : v.publishHeld, publicationOutcome: v.publicationOutcome,
        promotedVip: Array.isArray(v.promotedVip) ? v.promotedVip.length : undefined, promotedPremium: Array.isArray(v.promotedPremium) ? v.promotedPremium.length : undefined,
        quota: v.quota, remainingBeforeRun: v.remainingBeforeRun, attemptsByKickoffDay: v.attemptsByKickoffDay, keys: Object.keys(v) } });
  }

  // 4b. Every paid run in the last 4 days, compacted to what changed: when did
  // candidates enter the 24h warm band, were they priced, and why not targeted?
  const hist = await db.jobRun.findMany({ where: { job: "generate-vip-premium", ranAt: { gte: new Date(+now - 4 * D) } }, orderBy: { ranAt: "asc" }, select: { ranAt: true, detail: true } });
  let prevKey = "";
  for (const r of hist) {
    const d = (r.detail ?? {}) as Record<string, any>;
    const v = (d.vipPremium ?? {}) as Record<string, any>;
    const warm = Array.isArray(v.warmBandSkips) ? (v.warmBandSkips as Array<{ reason: string; signal: number | null; leagueApiId: number; quoteAgeMinutes: number | null }>) : [];
    const row = { reason: d.reason ?? d.skipped ?? null, inScope: v.inScope, oddsCalls: v.oddsCalls, warmed: v.warmed, fresh: v.freshlyPriced, qualified: v.qualified, claimed: d.claimed, created: d.predictionsCreated,
      skipped: v.skipped, warmBand: warm.map((w) => `${w.reason}${w.signal != null ? "@" + w.signal : ""}${w.quoteAgeMinutes != null ? "/age" + w.quoteAgeMinutes : "/noquote"}`).join(","),
      oddsBefore: v.readiness?.oddsBeforeWarming, rejected: v.rejectedReasons, published: v.published, evaluated: v.evaluated };
    const key = JSON.stringify({ ...row, oddsBefore: undefined, warmBand: warm.map((w) => w.reason).join(",") }).replace(/age\d+/g, "");
    if (key !== prevKey) out("vipRunHistory", { at: r.ranAt.toISOString(), ...row });
    prevKey = key;
  }
  // Spare-quota (thin-day widening) shadow and odds readiness for the latest runs.
  for (const r of hist.filter((_, i) => i % 8 === 0 || i === hist.length - 1).filter((r) => +r.ranAt > +now - 36 * H)) {
    const v = ((r.detail ?? {}) as Record<string, any>).vipPremium ?? {};
    const sq = v.spareQuota;
    const samples = (v.readiness?.oddsBeforeWarming?.samples ?? []) as Array<Record<string, unknown>>;
    out("spareAndReadiness", { at: r.ranAt.toISOString(), spare: sq ? { mode: sq.mode, slots: sq.slots, eligible: sq.eligible, qualifiedFromCache: sq.qualifiedFromCache, wouldTargetDays: count((sq.wouldTarget ?? []) as Array<{ kickoff: string; marketProbability: number }>, (w) => lagosDateKey(new Date(w.kickoff)) + "@" + Math.round(w.marketProbability)) } : null,
      fixtureDays: v.readiness?.fixtureDays, oddsBefore: { cache: v.readiness?.oddsBeforeWarming?.cache, market: v.readiness?.oddsBeforeWarming?.market, warm: count(samples, (x) => `${x.kickoffDay}:${x.warmReason}:${x.cacheState}:${x.marketState}`) } });
  }
  // Fixtures in the paid window whose ordinary rows all lack complete match context (never paid-eligible).
  const win = await db.prediction.findMany({ where: { kickoff: { gte: new Date(+now + 12 * H), lte: new Date(+now + 48 * H) }, status: { not: "ARCHIVED" }, leagueApiId: { in: [...PAID_CORE_LEAGUE_IDS] } }, select: { fixtureApiId: true, contextComplete: true, status: true, provenance: true, leagueApiId: true, kickoff: true, aiJobId: true } });
  const byFx = new Map<number, typeof win>();
  for (const w of win) if (w.fixtureApiId != null) byFx.set(w.fixtureApiId, [...(byFx.get(w.fixtureApiId) ?? []), w]);
  out("coreWindowContext", { fixtures: byFx.size, noContext: [...byFx.values()].filter((rs) => !rs.some((r) => r.contextComplete)).map((rs) => ({ league: rs[0].leagueApiId, day: lagosDateKey(rs[0].kickoff!), rows: rs.map((r) => `${r.provenance}:${r.status}`).join(",") })) });
  // Which generator wrote the rows with no match context, and how often did that
  // leave a paid-league fixture with NO context-complete ordinary row (30 days)?
  const span = await db.prediction.findMany({ where: { kickoff: { gte: new Date(+now - 30 * D), lte: new Date(+now + 4 * D) }, leagueApiId: { in: [...PAID_ANY_LEAGUE_IDS] }, fixtureApiId: { not: null }, status: { not: "ARCHIVED" } },
    select: { fixtureApiId: true, contextComplete: true, provenance: true, status: true, kickoff: true, leagueApiId: true, aiJobId: true, categories: { select: { category: true } } } });
  const jobIds = [...new Set(span.map((r) => r.aiJobId).filter((x): x is string => !!x))];
  const early = new Set<string>();
  for (let i = 0; i < jobIds.length; i += 400) for (const j of await db.aIJob.findMany({ where: { id: { in: jobIds.slice(i, i + 400) }, prompt: { contains: '"intent":"EARLY_FREE"' } }, select: { id: true } })) early.add(j.id);
  const fx2 = new Map<number, typeof span>();
  for (const r of span) fx2.set(r.fixtureApiId!, [...(fx2.get(r.fixtureApiId!) ?? []), r]);
  const dedicated = new Set<string>(DEDICATED_PAID_PROVENANCES as readonly string[]);
  const tally: Record<string, { fixtures: number; withPaid: number }> = {};
  const noCtxSources: Record<string, number> = {};
  for (const rs of fx2.values()) {
    const ord = rs.filter((r) => r.provenance !== "GOALS_GENERATED" && !dedicated.has(r.provenance));
    if (!ord.length) continue;
    const ctx = ord.some((r) => r.contextComplete);
    const allEarly = ord.every((r) => r.aiJobId && early.has(r.aiJobId));
    const anyEarly = ord.some((r) => r.aiJobId && early.has(r.aiJobId));
    const k = `${ctx ? "ctx" : "noCtx"}:${allEarly ? "earlyOnly" : anyEarly ? "mixed" : "regularOnly"}:${core.has(rs[0].leagueApiId ?? -1) ? "core" : "widened"}`;
    const t = (tally[k] ??= { fixtures: 0, withPaid: 0 }); t.fixtures++;
    if (rs.some((r) => r.status === "PUBLISHED" && r.categories.some((c) => c.category === "VIP" || c.category === "PREMIUM"))) t.withPaid++;
    if (!ctx && +rs[0].kickoff! > +now) noCtxSources[`${lagosDateKey(rs[0].kickoff!)}:${allEarly ? "earlyOnly" : anyEarly ? "mixed" : "regularOnly"}:${ord.map((r) => r.status).join("/")}`] = (noCtxSources[`${lagosDateKey(rs[0].kickoff!)}:${allEarly ? "earlyOnly" : anyEarly ? "mixed" : "regularOnly"}:${ord.map((r) => r.status).join("/")}`] ?? 0) + 1;
  }
  out("contextBySource30d", { tally, upcomingNoContext: noCtxSources });
  const drafts26 = await db.prediction.groupBy({ by: ["status", "provenance", "leagueApiId", "contextComplete"], where: { status: "DRAFT", kickoff: { gte: now } }, _count: true });
  out("draftRowsAhead", { rows: drafts26.map((d) => `${d.provenance}:${d.leagueApiId}:ctx${d.contextComplete}=${d._count}`) });
  const shadow = await db.jobRun.findMany({ where: { job: "paid-selection-shadow", ranAt: { gte: new Date(+now - 6 * D) } }, orderBy: { ranAt: "asc" }, select: { ranAt: true, summary: true } });
  out("paidCurationHistory", { lines: [...new Set(shadow.map((s) => s.summary ?? ""))] });
  // Confidence and market of the rows paid curation can draw on (published, core leagues), by kickoff day.
  const pool = await db.prediction.findMany({ where: { status: "PUBLISHED", kickoff: { gte: new Date(+now - 8 * D), lte: new Date(+now + 3 * D) }, marketType: { not: "SAME_GAME_DOUBLE" }, leagueApiId: { in: [...PAID_ANY_LEAGUE_IDS] } },
    select: { kickoff: true, confidence: true, marketType: true, provenance: true, leagueApiId: true, odds: true } });
  const poolDay: Record<string, Record<string, number>> = {};
  for (const r of pool) { const d = (poolDay[lagosDateKey(r.kickoff!)] ??= { rows: 0, conf75: 0, conf80: 0, core: 0, core75: 0, dc: 0, odds118: 0 }); d.rows++; if (r.confidence >= 75) d.conf75++; if (r.confidence >= 80) d.conf80++;
    if (r.leagueApiId != null && core.has(r.leagueApiId)) { d.core++; if (r.confidence >= 75) d.core75++; } if (r.marketType === "DOUBLE_CHANCE") d.dc++; if ((r.odds ?? 0) >= 1.18) d.odds118++; }
  out("paidPoolByKickoffDay", { byDay: Object.fromEntries(Object.entries(poolDay).sort()) });

  // 5. Backoffs, reservations, settings that can stop the pass.
  const locks = await db.appLock.findMany({ where: { key: { startsWith: VIP_PREMIUM_BACKOFF_LOCK_PREFIX }, expiresAt: { gt: now } }, select: { key: true } });
  const otherLocks = await db.appLock.findMany({ where: { expiresAt: { gt: now } }, select: { key: true, expiresAt: true } });
  out("locks", { paidBackoffs: locks.length, activeLocks: otherLocks.filter((l) => !l.key.startsWith(VIP_PREMIUM_BACKOFF_LOCK_PREFIX)).map((l) => ({ key: l.key.replace(/\d{5,}/g, "#"), until: l.expiresAt.toISOString() })) });
  const res = await db.paidQuotaAttempt.findMany({ where: { createdAt: { gte: new Date(+now - 7 * D) } }, select: { kickoffDay: true, spendDay: true, reservedMicroUsd: true, usageReliable: true } }).catch(() => []);
  out("paidQuotaReservations", { bySpendDay: count(res, (r) => String(r.spendDay)), byKickoffDay: count(res, (r) => String(r.kickoffDay)) });
  const usage = await db.apiUsage.findMany({ where: { day: { gte: lagosDateKey(new Date(+now - 3 * D)).slice(0, 10), lt: "a" } }, select: { day: true, count: true } }).catch(() => []);
  out("apiUsage", { perDay: usage.reduce<Record<string, number>>((o, u) => { o[u.day] = (o[u.day] ?? 0) + u.count; return o; }, {}) });
  // 6. Paid rows recently archived/rejected (were drafts produced and discarded?).
  const drafts = await db.prediction.findMany({ where: { createdAt: { gte: new Date(+now - 4 * D) }, provenance: { in: [...DEDICATED_PAID_PROVENANCES] } }, select: { status: true, provenance: true, createdAt: true } }).catch(() => []);
  out("dedicatedDrafts4d", { byDay: count(drafts, (d) => `${lagosDateKey(d.createdAt)}:${d.provenance}:${d.status}`) });
  const provs = await db.prediction.groupBy({ by: ["provenance", "status"], where: { createdAt: { gte: new Date(+now - 4 * D) } }, _count: true });
  out("provenance4d", { rows: provs.map((p) => `${p.provenance}:${p.status}=${p._count}`) });
}
main().catch((e) => { console.error(String(e?.message ?? e).slice(0, 500)); process.exit(1); }).finally(() => db.$disconnect());
