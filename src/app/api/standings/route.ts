import { NextResponse } from "next/server";
import { getStandings, MAJOR_LEAGUES } from "@/lib/football/api-football";

export const revalidate = 3600;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const leagueId = Number(url.searchParams.get("league") || 39);
  const season = Number(url.searchParams.get("season") || new Date().getFullYear());
  const table = (await getStandings(leagueId, season)) ?? [];
  const meta = MAJOR_LEAGUES.find((l) => l.id === leagueId);
  return NextResponse.json({ league: meta, season, table });
}
