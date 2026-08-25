import { NextResponse } from "next/server";
import { getStandings } from "@/lib/football/api-football";
import { LEAGUE_CATALOGUE } from "@/lib/leagues";
import { cupSupports } from "@/lib/cupConfig";

export const revalidate = 3600;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const leagueId = Number(url.searchParams.get("league") || 39);
  if (!LEAGUE_CATALOGUE.some((league) => league.id === leagueId) || !cupSupports(leagueId, "standings")) {
    return NextResponse.json({ error: "Standings are not supported for this competition" }, { status: 400 });
  }
  const season = Number(url.searchParams.get("season") || new Date().getFullYear());
  const table = (await getStandings(leagueId, season)) ?? [];
  const meta = LEAGUE_CATALOGUE.find((l) => l.id === leagueId);
  return NextResponse.json({ league: meta, season, table });
}
