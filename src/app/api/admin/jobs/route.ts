import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { JOB_GENERATION_DISCOVERY, KNOWN_JOBS } from "@/lib/jobRuns";
import { VIP_PROXY_LEAGUE_IDS } from "@/lib/ai/generationRisk";
import { MC_MAX_QUOTE_AGE_MS } from "@/lib/marketConfirmed";
import { matchKey } from "@/lib/slug";

export const dynamic = "force-dynamic";

/**
 * Scheduled-job health, for /admin/jobs.
 *
 * WHY THIS ENDPOINT EXISTS. Production scheduling lives in cron-job.org, which
 * nothing in this app can see. That made two very different situations look
 * identical from the inside: a pass that fires constantly and finds nothing, and
 * a pass that is not scheduled at all. Both produce no picks. The first is a
 * code problem, the second is a config problem, and for weeks the only way to
 * tell them apart was to log into a third-party scheduler.
 *
 * So this reports, per job, WHEN it last ran and WHAT it did — plus the pool
 * figures that say whether "did nothing" was reasonable.
 */
const H72 = 72 * 60 * 60 * 1000;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();

  /**
   * ONE QUERY PER JOB, not one shared query with a row cap.
   *
   * THE BUG THIS FIXES. This used to be a single findMany over every known job
   * with `take: 200`, grouped in memory. That silently reports a job as NEVER
   * RUN as soon as 200 newer rows exist from other jobs — and the jobs are
   * wildly different frequencies. Measured against production: those 200 rows
   * spanned 3h20m, because notifications-dispatch alone contributed 101 of
   * them. Every job that runs less often than roughly every three hours fell
   * out of the window entirely:
   *
   *   generate-bet-of-the-day   1 row,  last run 05:20  -> reported "never run"
   *   select-bet-of-the-day     1 row,  last run 05:50  -> reported "never run"
   *   curate-accumulators      13 rows, last run 10:45  -> reported "never run"
   *
   * All three had run successfully. `settle` was one row from joining them.
   *
   * That is the worst possible failure for this page, because "never run —
   * check the schedule" is its loudest alarm and it was firing at healthy daily
   * jobs while staying quiet about nothing. A page built to distinguish "the
   * cron never fired" from "it fired and stood down" was reporting the former
   * for jobs doing the latter correctly.
   *
   * Per-job queries cannot have that failure: each job's history is bounded by
   * its own take, so a chatty job cannot evict a quiet one. Ten small lookups,
   * each served by the @@index([job, ranAt]) that already exists for exactly
   * this access pattern.
   */
  const RECENT_PER_JOB = 8;
  const histories = await Promise.all(
    KNOWN_JOBS.map((job) =>
      prisma.jobRun.findMany({
        where: { job },
        orderBy: { ranAt: "desc" },
        take: RECENT_PER_JOB,
        select: { id: true, job: true, ranAt: true, ok: true, summary: true, ms: true },
      }),
    ),
  );

  const jobs = KNOWN_JOBS.map((job, i) => {
    const mine = histories[i];
    const last = mine[0] ?? null;
    return {
      job,
      lastRanAt: last?.ranAt ?? null,
      lastOk: last?.ok ?? null,
      lastSummary: last?.summary ?? null,
      lastMs: last?.ms ?? null,
      // Never recorded a run is the single most actionable state here: it means
      // the schedule is missing, not that the job stood down. It is now a fact
      // about THIS job's own history rather than about how busy its neighbours
      // have been — see the note on the queries above.
      neverRan: mine.length === 0,
      recent: mine,
    };
  });

  // The pool figures. Without these, "claimed 0" is unreadable: it is either a
  // starved pass or a genuinely quiet slate.
  const ledger = await prisma.generationAttempt.findMany({
    where: { kickoff: { gte: now, lte: new Date(now.getTime() + H72) } },
    select: { matchKey: true, status: true, leagueApiId: true, nextAttemptAt: true },
  });
  const paid = (id: number | null) => (VIP_PROXY_LEAGUE_IDS as readonly number[]).includes(id ?? -1);
  const pending = ledger.filter((l) => l.status === "PENDING");

  const published = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gt: now, lte: new Date(now.getTime() + H72) }, homeTeamApiId: { not: null }, awayTeamApiId: { not: null } },
    select: { homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
  });
  const keys = [...new Set([...ledger.map((l) => l.matchKey), ...published.map((p) => matchKey(p as never))].filter((k): k is string => !!k))];
  const cache = keys.length
    ? await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys } }, select: { fetchedAt: true } })
    : [];
  const priced = cache.filter((c) => c.fetchedAt != null);

  // The competition scope the latest discovery run chose, straight from its
  // run detail. Read rather than recomputed so the page shows what discovery
  // actually decided and why, including runs that correctly did nothing.
  const [lastDiscovery] = await prisma.jobRun.findMany({
    where: { job: JOB_GENERATION_DISCOVERY },
    orderBy: { ranAt: "desc" },
    take: 1,
    select: { ranAt: true, detail: true },
  });
  const coverageDetail = (lastDiscovery?.detail as { coverage?: unknown } | null | undefined)?.coverage ?? null;

  return NextResponse.json({
    now,
    jobs,
    coverage: coverageDetail ? { ranAt: lastDiscovery!.ranAt, ...(coverageDetail as object) } : null,
    pool: {
      horizonHours: 72,
      fixtures: keys.length,
      paidTierFixtures: ledger.filter((l) => paid(l.leagueApiId)).length,
      // A reservation is a PENDING row still serving its grace window — see
      // lib/generation/paidTierGrace.
      pendingTotal: pending.length,
      pendingPaidTier: pending.filter((l) => paid(l.leagueApiId)).length,
      reservedForPaidTier: pending.filter((l) => paid(l.leagueApiId) && l.nextAttemptAt && l.nextAttemptAt > now).length,
      oddsAny: priced.length,
      oddsFresh: priced.filter((c) => now.getTime() - c.fetchedAt!.getTime() <= MC_MAX_QUOTE_AGE_MS).length,
      oddsFreshnessLimitHours: MC_MAX_QUOTE_AGE_MS / 3600000,
      oddsMissing: keys.length - priced.length,
    },
  });
}
