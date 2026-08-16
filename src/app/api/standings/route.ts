import { NextResponse } from "next/server";
import { getStandings } from "@/lib/football/api-football";
import { LEAGUE_CATALOGUE } from "@/lib/leagues";

export const revalidate = 3600;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const leagueId = Number(url.searchParams.get("league") || 39);
  const season = Number(url.searchParams.get("season") || new Date().getFullYear());
  const table = (await getStandings(leagueId, season)) ?? [];
  const meta = LEAGUE_CATALOGUE.find((l) => l.id === leagueId);
  return NextResponse.json({ league: meta, season, table });
}
