import { NextResponse } from "next/server";
import { getLiveSnapshot } from "@/lib/liveSnapshot";

export const dynamic = "force-dynamic";

/**
 * In-play scores for the Livescores page, match pages and live scores on tips.
 *
 * Served from the shared snapshot (src/lib/liveSnapshot.ts), which asks the
 * provider at most once per 30 seconds site-wide and caps its calls per day,
 * so the number of readers never changes what this costs. The short shared
 * cache below also lets the CDN answer most polls without touching the
 * database.
 */
export async function GET() {
  const snapshot = await getLiveSnapshot();
  return NextResponse.json(
    { live: snapshot.rows, fetchedAt: snapshot.fetchedAt },
    { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=15" } },
  );
}
