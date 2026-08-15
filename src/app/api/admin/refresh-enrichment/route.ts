import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import {
  getScopedTeamTargets,
  getScopedLeagueTargets,
  getScopedFixtureTargets,
  orderTeamsByStaleness,
  orderLeaguesByStaleness,
  orderFixtureDaysByStaleness,
  getScopedH2HTargets,
  selectStaleH2HTargets,
  refreshTeamCache,
  refreshLeagueCache,
  refreshFixtureDetailsForDay,
  refreshH2HCache,
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
  // A team refresh costs ~4 throttled calls (~26s at MIN_GAP_MS=6500), a
  // league ~2 (~13s) — 6 of each keeps a combined run around 234s, safely
  // inside maxDuration=300 (settle's default of 15 would overrun here, since
  // this route's per-item call cost is higher).
  const limit = Math.min(8, Math.max(1, Number(url.searchParams.get("limit")) || 6));

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
    orderTeamsByStaleness(teamTargets),
    orderLeaguesByStaleness(leagueTargets),
    orderFixtureDaysByStaleness(fixtureTargets),
    selectStaleH2HTargets(h2hTargets),
  ]);
  const teamSlice = orderedTeams.slice(0, limit);
  const leagueSlice = orderedLeagues.slice(0, limit);
  const fixtureDaySlice = orderedFixtureDays.slice(0, limit);
  // One call per pair, and the stale filter usually leaves this list empty
  // once a cycle has caught up — a head-to-head only changes when the two
  // teams meet again.
  const h2hSlice = staleH2H.slice(0, limit);

  const results: Array<{ kind: "team" | "league" | "fixture" | "h2h"; id: number | string; result: string; detail?: string }> = [];

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

  return NextResponse.json({
    scopedTeams: teamTargets.length,
    scopedLeagues: leagueTargets.length,
    scopedFixtures: fixtureTargets.length,
    scopedH2HPairs: h2hTargets.length,
    staleH2HPairs: staleH2H.length,
    processedH2HPairs: h2hSlice.length,
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
