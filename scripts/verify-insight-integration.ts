/**
 * Database integration check for the Match Insights worker. Runs only against
 * the disposable local test database; the provider is replaced by a stub, so
 * no api-football calls are made.
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import type { FixtureRow } from "../src/lib/football/api-football";
import { HISTORY_MAX_AGE_MS, HISTORY_REFETCH_MS, refreshMatchInsights } from "../src/lib/insightRefresh";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "55432" || !url.pathname.endsWith("/betgenius_feature_test")) {
  throw new Error("Refusing to run outside the disposable BetGenius test database");
}
const prisma = new PrismaClient();
const HOME = 99001, AWAY = 99002, OTHER = 99003;
const EMAIL = "verify-insights-author@example.test";

function row(id: number, teamId: number, daysAgo: number, own: number, against: number, now: Date, status = "FT"): FixtureRow {
  return {
    fixture: { id, date: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(), status: { short: status } },
    league: { id: 39, name: "Premier League", country: "England", season: 2026 },
    teams: { home: { id: teamId, name: `Team ${teamId}` }, away: { id: 98000 + id, name: `Opp ${id}` } },
    goals: { home: own, away: against },
    score: { halftime: { home: 0, away: 0 }, fulltime: { home: own, away: against }, extratime: { home: null, away: null }, penalty: { home: null, away: null } },
  };
}

async function clear() {
  const users = await prisma.user.findMany({ where: { email: EMAIL }, select: { id: true } });
  await prisma.prediction.deleteMany({ where: { authorId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.teamFixtureHistory.deleteMany({ where: { teamApiId: { in: [HOME, AWAY, OTHER] } } });
  await prisma.matchInsightCache.deleteMany({ where: { teamApiId: { in: [HOME, AWAY, OTHER] } } });
}

async function main() {
  await clear();
  const now = new Date();
  const author = await prisma.user.create({ data: { email: EMAIL, role: "ADMIN" } });
  const kickoff = new Date(now.getTime() + 24 * 3_600_000);
  const tip = await prisma.prediction.create({
    data: {
      category: "FEATURED", leagueApiId: 39, leagueName: "Premier League", homeTeam: `Team ${HOME}`, awayTeam: `Team ${AWAY}`,
      homeTeamApiId: HOME, awayTeamApiId: AWAY, fixtureApiId: 99999, kickoff, status: "PUBLISHED", publishedAt: now,
      marketType: "MATCH_WINNER", selection: { side: "HOME" }, manualSettlementOnly: false, market: "Match winner", pick: "Home",
      confidence: 70, reasoning: "Synthetic insight verification row", outcome: "PENDING", authorId: author.id,
      categories: { create: [{ category: "FEATURED" }] },
    },
  });

  let calls = 0;
  const wins = (team: number, base: number) => [1, 2, 3, 4, 5, 6].map((d) => row(base + d, team, d, 2, 0, now)).concat(row(base + 7, team, 7, 0, 1, now));
  const provider = async (team: number) => { calls++; return team === HOME ? wins(HOME, 1000) : team === AWAY ? wins(AWAY, 2000) : []; };

  const first = await refreshMatchInsights({ now, fetcher: provider as any });
  assert.equal(first.targets, 2);
  assert.equal(first.fetched, 2, "both teams' histories are fetched on the first run");
  const stored = await prisma.matchInsightCache.findMany({ where: { teamApiId: HOME } });
  const winRun = stored.find((r) => r.type === "WIN_STREAK" && r.scope === "ALL");
  assert.ok(winRun, "a six-match winning run is stored");
  assert.equal((winRun!.evidence as any).explanation, "Won 6 matches in a row.");
  assert.equal(winRun!.predictionId, tip.id);
  assert.ok(winRun!.expiresAt.getTime() <= kickoff.getTime(), "evidence never outlives its target kickoff");

  const second = await refreshMatchInsights({ now: new Date(now.getTime() + 60_000), fetcher: provider as any });
  assert.equal(second.fetched, 0, "a fresh history is not refetched");
  assert.equal(second.teamsWritten, 0, "unchanged evidence is not rewritten");

  // A known match finished after the fetch and is missing from it: refetch immediately.
  const later = new Date(now.getTime() + 4 * 3_600_000);
  await prisma.prediction.create({
    data: {
      category: "FEATURED", leagueApiId: 39, leagueName: "Premier League", homeTeam: `Team ${HOME}`, awayTeam: `Team ${OTHER}`,
      homeTeamApiId: HOME, awayTeamApiId: OTHER, fixtureApiId: 99998, kickoff: new Date(now.getTime() + 60 * 60_000), status: "ARCHIVED",
      marketType: "MATCH_WINNER", selection: { side: "HOME" }, manualSettlementOnly: false, market: "Match winner", pick: "Home",
      confidence: 60, reasoning: "Synthetic finished fixture", outcome: "PENDING", authorId: author.id, categories: { create: [{ category: "FEATURED" }] },
    },
  });
  const beaten = async (team: number) => { calls++; return team === HOME ? [row(99998, HOME, 0.05, 0, 3, later), ...wins(HOME, 1000)] : wins(AWAY, 2000); };
  const third = await refreshMatchInsights({ now: later, fetcher: beaten as any });
  assert.equal(third.fetched, 1, "only the team with a missing finished match is refetched");
  assert.equal(await prisma.matchInsightCache.count({ where: { teamApiId: HOME, type: "WIN_STREAK" } }), 0, "the broken winning run is removed at once, not left to expire");

  // Provider failure beyond the maximum age: the team's insights are withdrawn, not shown stale.
  const stale = new Date(now.getTime() + HISTORY_MAX_AGE_MS + HISTORY_REFETCH_MS);
  const failing = async () => { calls++; return null; };
  const fourth = await refreshMatchInsights({ now: stale, fetcher: failing as any });
  assert.equal(fourth.fetchFailed, 2);
  assert.equal(await prisma.matchInsightCache.count({ where: { teamApiId: { in: [HOME, AWAY] }, expiresAt: { gt: stale } } }), 0, "no evidence is served from an over-age history");

  console.log("insight database integration checks passed", { providerCalls: calls });
}

main().finally(async () => {
  await clear();
  await prisma.$disconnect();
});
