import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { KNOWN_JOBS } from "@/lib/jobRuns";
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

  // Last run of each known job, plus a short history. One query, then grouped
  // in memory — there are a handful of jobs, not thousands.
  const runs = await prisma.jobRun.findMany({
    where: { job: { in: [...KNOWN_JOBS] } },
    orderBy: { ranAt: "desc" },
    take: 200,
    select: { id: true, job: true, ranAt: true, ok: true, summary: true, ms: true },
  });

  const jobs = KNOWN_JOBS.map((job) => {
    const mine = runs.filter((r) => r.job === job);
    const last = mine[0] ?? null;
    return {
      job,
      lastRanAt: last?.ranAt ?? null,
      lastOk: last?.ok ?? null,
      lastSummary: last?.summary ?? null,
      lastMs: last?.ms ?? null,
      // Never recorded a run is the single most actionable state here: it means
      // the schedule is missing, not that the job stood down.
      neverRan: mine.length === 0,
      recent: mine.slice(0, 8),
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

  return NextResponse.json({
    now,
    jobs,
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
