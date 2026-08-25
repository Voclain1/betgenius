/**
 * Sizes the proposed widening of odds caching before it is committed to.
 *
 * The estimate offered when this was proposed was "~50-150 extra calls/day".
 * That was arithmetic on assumed candidate counts, not a measurement, so this
 * counts the real rows: how many GenerationAttempt candidates would newly be
 * priced, over what horizon, and what that actually costs per day against the
 * 7,500/day api-football ceiling.
 *
 * Read-only. Spends no api-football quota — every number here comes from rows
 * the pipeline already writes.
 *
 * Run: npx tsx --env-file=.env scripts/measure-odds-scope.ts
 */
export {};

import { prisma } from "../src/lib/prisma";
import { lagosTodayBounds } from "../src/lib/lagosDate";
import { leaguePriorityRank } from "../src/lib/leagues";
import { getUsageSnapshot } from "../src/lib/football/usage";

const HOURS = 60 * 60 * 1000;

async function main() {
  const now = new Date();
  const { start, end } = lagosTodayBounds(now);

  // --- What the CURRENT scope prices: today's published predictions ---
  const publishedToday = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: start, lt: end }, homeTeamApiId: { not: null }, awayTeamApiId: { not: null } },
    select: { homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
  });
  const publishedKeys = new Set(
    publishedToday
      .filter((r) => r.kickoff)
      .map((r) => `${r.homeTeamApiId}-${r.awayTeamApiId}-${r.kickoff!.toISOString().slice(0, 10)}`),
  );

  // --- What the WIDENED scope would add: PENDING generation candidates ---
  // Bucketed by how far out kickoff is, because the research settled that odds
  // beyond ~7 days are mostly absent (13% hit rate) — pricing those would be
  // spending quota to re-confirm an empty response, so the horizon chosen here
  // is the whole cost question.
  const pending = await prisma.generationAttempt.findMany({
    where: { status: "PENDING", kickoff: { gt: now } },
    select: { matchKey: true, leagueApiId: true, kickoff: true },
  });

  const horizons = [24, 48, 72, 168] as const;
  const rows: any[] = [];

  for (const h of horizons) {
    const within = pending.filter((p) => p.kickoff.getTime() - now.getTime() <= h * HOURS);
    const newlyPriced = within.filter((p) => !publishedKeys.has(p.matchKey));
    // Only candidates in a league we actually rank can win the slot, since
    // selection is league-priority-first — so this is the number that matters.
    const ranked = newlyPriced.filter((p) => leaguePriorityRank(p.leagueApiId) < 999);
    rows.push({
      horizonHours: h,
      pendingCandidates: within.length,
      notAlreadyPriced: newlyPriced.length,
      inRankedLeagues: ranked.length,
      // One /odds call each, once. Re-priced hourly only inside 24h of kickoff
      // (see selectStaleOddsTargets), so the daily cost is roughly one call per
      // candidate plus up to 24 refreshes for the near-kickoff subset.
      firstPassCalls: ranked.length,
    });
  }

  // Near-kickoff refresh load: candidates inside 24h get re-priced hourly.
  const near = pending.filter((p) => p.kickoff.getTime() - now.getTime() <= 24 * HOURS && !publishedKeys.has(p.matchKey));
  const nearRanked = near.filter((p) => leaguePriorityRank(p.leagueApiId) < 999).length;

  const usage = await getUsageSnapshot();
  const alreadyPriced = await prisma.fixtureOddsCache.count({ where: { fetchedAt: { not: null } } });

  console.log(
    JSON.stringify(
      {
        measuredAt: now.toISOString(),
        currentScope: {
          publishedTodayWithTeamIds: publishedToday.length,
          distinctFixtures: publishedKeys.size,
          alreadyCachedWithPrices: alreadyPriced,
        },
        pendingCandidateTotal: pending.length,
        byHorizon: rows,
        nearKickoffHourlyRefresh: {
          candidatesInside24h: nearRanked,
          worstCaseRefreshCallsPerDay: nearRanked * 24,
          note: "worst case assumes every one stays inside 24h for a full day and is re-priced every hour",
        },
        quota: { limit: usage.limit, reserve: usage.reserve, usedToday: usage.used, remaining: usage.remaining },
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main();
