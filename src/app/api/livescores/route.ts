import { NextResponse } from "next/server";
import { getLiveSnapshot } from "@/lib/liveSnapshot";

export const dynamic = "force-dynamic";

/**
 * In-play scores for the Livescores page, match pages and live scores on tips.
 *
 * Served from the shared snapshot (src/lib/liveSnapshot.ts), refreshed from
 * the provider as often as every 15 seconds site-wide (slower only as the
 * day's quota runs down), so the number of readers never changes what this
 * costs. The 5-second shared cache lets the CDN answer bursts of polls
 * without touching the database, at no visible cost to freshness.
 */
export async function GET() {
  const snapshot = await getLiveSnapshot();
  return NextResponse.json(
    { live: snapshot.rows, fetchedAt: snapshot.fetchedAt },
    { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" } },
  );
}
