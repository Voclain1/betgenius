import { NextResponse } from "next/server";
import { getStandings, resolveSeason } from "@/lib/football/api-football";
import { LEAGUE_CATALOGUE } from "@/lib/leagues";
import { cupSupports } from "@/lib/cupConfig";

export const revalidate = 3600;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const leagueId = Number(url.searchParams.get("league") || 39);
  if (!LEAGUE_CATALOGUE.some((league) => league.id === leagueId) || !cupSupports(leagueId, "standings")) {
    return NextResponse.json({ error: "Standings are not supported for this competition" }, { status: 400 });
  }
  // The calendar year is the wrong default: API-Football numbers a season by
  // the year it started, so from January to July the year names a season
  // that has not begun and the table came back empty.
  const season = Number(url.searchParams.get("season")) || (await resolveSeason(leagueId, new Date()));
  const table = (await getStandings(leagueId, season)) ?? [];
  const meta = LEAGUE_CATALOGUE.find((l) => l.id === leagueId);
  return NextResponse.json({ league: meta, season, table });
}
