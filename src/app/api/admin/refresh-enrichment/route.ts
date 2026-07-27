import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { getScopedTeamTargets, getScopedLeagueTargets, orderTeamsByStaleness, orderLeaguesByStaleness, refreshTeamCache, refreshLeagueCache } from "@/lib/enrichment";

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

  const [teamTargets, leagueTargets] = await Promise.all([getScopedTeamTargets(), getScopedLeagueTargets()]);
  const [orderedTeams, orderedLeagues] = await Promise.all([orderTeamsByStaleness(teamTargets), orderLeaguesByStaleness(leagueTargets)]);
  const teamSlice = orderedTeams.slice(0, limit);
  const leagueSlice = orderedLeagues.slice(0, limit);

  const results: Array<{ kind: "team" | "league"; id: number; result: string; detail?: string }> = [];

  for (const t of teamSlice) {
    const r = await refreshTeamCache(t);
    results.push({ kind: "team", id: t.teamApiId, result: r.result, detail: r.detail });
  }
  for (const l of leagueSlice) {
    const r = await refreshLeagueCache(l);
    results.push({ kind: "league", id: l.leagueApiId, result: r.result, detail: r.detail });
  }

  return NextResponse.json({
    scopedTeams: teamTargets.length,
    scopedLeagues: leagueTargets.length,
    processedTeams: teamSlice.length,
    processedLeagues: leagueSlice.length,
    okCount: results.filter((r) => r.result === "ok").length,
    failedCount: results.filter((r) => r.result !== "ok").length,
    results,
  });
}
