import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import {
  getScopedTeamTargets,
  getScopedLeagueTargets,
  getScopedFixtureTargets,
  orderTeamsByPriority,
  orderLeaguesByStaleness,
  orderFixtureDaysByStaleness,
  getScopedH2HTargets,
  selectStaleH2HTargets,
  refreshTeamCache,
  refreshLeagueCache,
  refreshFixtureDetailsForDay,
  refreshH2HCache,
  selectStalePlayerStatLeagues,
  refreshLeaguePlayerStats,
  selectStaleSquadTargets,
  refreshTeamSquad,
} from "@/lib/enrichment";

// Same shape as /api/admin/settle: runs sequentially through the throttled
// api-football queue, bound generously since Vercel Cron invokes via a single
// request with no retry-on-timeout.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const session = await getServerSession(authOptions);
  return isAdmin(session?.user.role);
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  // Raised from 6/8 for production volume. At 50-100 predictions a day the
  // scoped set reaches 100-200 distinct teams, which the old ceiling could only
  // cycle through every 2-4 days — far too slow for team news.
  //
  // 25 teams costs ~100 throttled calls; at MIN_GAP_MS=250 that is ~25s of
  // pacing plus latency, landing around 40-60s and leaving ample room inside
  // maxDuration=300 for the league/fixture/h2h/squad slices that follow.
  //
  // The tiering in orderTeamsByPriority means this is a ceiling, not a target:
  // teams already inside their tier's freshness tolerance are skipped entirely,
  // so a quiet period costs far fewer calls than a busy one.
  const limit = Math.min(30, Math.max(1, Number(url.searchParams.get("limit")) || 25));

  // Fixture detail is batched one call per kickoff DAY (see
  // refreshFixtureDetailsForDay), so its slice is counted in days, not
  // fixtures — `limit` days adds at most `limit` calls (~6s at MIN_GAP_MS),
  // which the existing team+league budget above leaves ample room for.
  const [teamTargets, leagueTargets, fixtureTargets, h2hTargets] = await Promise.all([
    getScopedTeamTargets(),
    getScopedLeagueTargets(),
    getScopedFixtureTargets(),
    getScopedH2HTargets(),
  ]);
  const [orderedTeams, orderedLeagues, orderedFixtureDays, staleH2H] = await Promise.all([
    orderTeamsByPriority(teamTargets),
    orderLeaguesByStaleness(leagueTargets),
    orderFixtureDaysByStaleness(fixtureTargets),
    selectStaleH2HTargets(h2hTargets),
  ]);
  // Three calls per league, but gated on a 12h TTL rather than the 3-hourly
  // cadence — leaderboards only move when matches are played.
  const stalePlayerLeagues = (await selectStalePlayerStatLeagues(leagueTargets)).slice(0, limit);
  // Two calls per team on a 7-day TTL. Cost scales with TEAM count rather than
  // league count, so this slice is the main guard against a large scoped set
  // turning one run into hundreds of calls.
  const staleSquadTeams = (await selectStaleSquadTargets(teamTargets)).slice(0, limit);
  const teamSlice = orderedTeams.slice(0, limit);
  const leagueSlice = orderedLeagues.slice(0, limit);
  const fixtureDaySlice = orderedFixtureDays.slice(0, limit);
  // One call per pair, and the stale filter usually leaves this list empty
  // once a cycle has caught up — a head-to-head only changes when the two
  // teams meet again.
  const h2hSlice = staleH2H.slice(0, limit);

  const results: Array<{ kind: "team" | "league" | "fixture" | "h2h" | "players" | "squad"; id: number | string; result: string; detail?: string }> = [];

  for (const t of teamSlice) {
    const r = await refreshTeamCache(t);
    results.push({ kind: "team", id: t.teamApiId, result: r.result, detail: r.detail });
  }
  for (const l of leagueSlice) {
    const r = await refreshLeagueCache(l);
    results.push({ kind: "league", id: l.leagueApiId, result: r.result, detail: r.detail });
  }
  for (const d of fixtureDaySlice) {
    for (const r of await refreshFixtureDetailsForDay(d.day, d.targets)) {
      results.push({ kind: "fixture", id: r.matchKey, result: r.result, detail: r.detail });
    }
  }

  for (const t of h2hSlice) {
    const r = await refreshH2HCache(t);
    results.push({ kind: "h2h", id: t.pairKey, result: r.result, detail: r.detail ?? (r.meetings != null ? `${r.meetings} meetings` : undefined) });
  }

  for (const l of stalePlayerLeagues) {
    const r = await refreshLeaguePlayerStats(l);
    results.push({ kind: "players", id: l.leagueApiId, result: r.result, detail: r.detail ?? r.counts });
  }

  for (const t of staleSquadTeams) {
    const r = await refreshTeamSquad(t);
    results.push({ kind: "squad", id: t.teamApiId, result: r.result, detail: r.detail });
  }

  return NextResponse.json({
    scopedTeams: teamTargets.length,
    scopedLeagues: leagueTargets.length,
    scopedFixtures: fixtureTargets.length,
    scopedH2HPairs: h2hTargets.length,
    staleH2HPairs: staleH2H.length,
    processedH2HPairs: h2hSlice.length,
    processedPlayerStatLeagues: stalePlayerLeagues.length,
    processedSquadTeams: staleSquadTeams.length,
    scopedFixtureDays: orderedFixtureDays.length,
    processedTeams: teamSlice.length,
    processedLeagues: leagueSlice.length,
    processedFixtureDays: fixtureDaySlice.length,
    processedFixtures: fixtureDaySlice.reduce((n, d) => n + d.targets.length, 0),
    okCount: results.filter((r) => r.result === "ok").length,
    failedCount: results.filter((r) => r.result !== "ok").length,
    results,
  });
}
