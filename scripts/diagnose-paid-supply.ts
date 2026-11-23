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
  for (const job of ["generate-vip-premium", "paid-selection-shadow", "generate-ordinary", "refresh-odds", "curate-accumulators"]) {
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
