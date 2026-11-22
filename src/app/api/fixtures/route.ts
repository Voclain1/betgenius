import { NextResponse } from "next/server";
import { attributeApiJob } from "@/lib/football/usage";
import { getFixturesByDate } from "@/lib/football/api-football";

async function getUnattributed(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const rows = (await getFixturesByDate(date)) ?? [];
  return NextResponse.json({ date, fixtures: rows });
}

// API-Football telemetry: requests made by this handler are attributed to this job (src/lib/football/usage.ts).
export const GET = attributeApiJob("site:fixtures", getUnattributed);
