import { NextResponse } from "next/server";
import { getFixturesByDate } from "@/lib/football/api-football";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const rows = (await getFixturesByDate(date)) ?? [];
  return NextResponse.json({ date, fixtures: rows });
}
