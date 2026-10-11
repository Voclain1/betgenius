import { NextResponse } from "next/server";
import { canViewCategory } from "@/lib/access";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import type { PredictionCategory } from "@/lib/enums";
import { FEED_RESULTS_CATEGORIES, getFeedDayResults, resultsDayBounds, shapeDayResults } from "@/lib/feedResults";

export const dynamic = "force-dynamic";

/**
 * One past day of a VIP, Premium or Banker feed, for the results section at
 * the foot of that feed's page (src/components/FeedResults.tsx). Read only
 * when a reader opens the day.
 *
 * The pick is withheld from a reader who cannot view the category, the same
 * rule the feed's own "yesterday" tab applies. Because the answer depends on
 * who is asking, it is cached privately in the browser only, never on a
 * shared cache that could hand one reader's view to another.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category")?.toUpperCase() as PredictionCategory | undefined;
  if (!category || !FEED_RESULTS_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }
  const bounds = resultsDayBounds(url.searchParams.get("day"));
  if (!bounds) return NextResponse.json({ error: "Day must be a past date within the last 90 days" }, { status: 400 });

  const viewer = await getViewerEntitlement();
  const canView = canViewCategory(category, viewer.tier, viewer.status, viewer.role);
  const results = shapeDayResults(await getFeedDayResults(category, bounds), canView);

  return NextResponse.json({ results, locked: !canView }, { headers: { "Cache-Control": "private, max-age=300" } });
}
