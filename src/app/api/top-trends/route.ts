import { NextResponse } from "next/server";
import { loadTopTrends } from "@/lib/topTrends";

/**
 * Data for the Top trends panel beside the prediction pages.
 *
 * A route rather than a query in the predictions layout: several of those
 * pages are statically rendered, and a layout that read the database would
 * either freeze the panel at build time or force every one of them dynamic.
 * The panel is identical for every visitor, so the edge caches it briefly;
 * insights themselves only change every fifteen minutes.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const trends = await loadTopTrends(6);
  return NextResponse.json(
    { trends },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } },
  );
}
