import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { PredictionCategory } from "@/lib/enums";
import { lagosTodayBounds } from "@/lib/lagosDate";
import { orderForDisplay } from "@/lib/predictionOrdering";

// Shared between /predictions/[category] and the account dashboard so the
// two never end up running two slightly different queries for the same
// "published predictions in category X" data.

export const CATEGORY_SLUGS: Record<string, PredictionCategory> = {
  featured: "FEATURED",
  genius: "GENIUS",
  today: "TODAY",
  banker: "BANKER",
  vip: "VIP",
  premium: "PREMIUM",
  "bet-of-the-day": "BET_OF_THE_DAY",
};

export const CATEGORY_NAMES: Record<PredictionCategory, string> = {
  FEATURED: "Featured tips",
  GENIUS: "Genius tips",
  TODAY: "Today's predictions",
  BANKER: "Banker",
  VIP: "VIP tips",
  PREMIUM: "Premium tips",
  BET_OF_THE_DAY: "Bet of the Day",
};

export const CATEGORY_TO_SLUG = Object.fromEntries(
  Object.entries(CATEGORY_SLUGS).map(([slug, cat]) => [cat, slug]),
) as Record<PredictionCategory, string>;

// Shared between generateMetadata and the page body on /predictions/[category]
// (and now the dashboard) so a given category's predictions are only fetched
// once per request — React's cache() memoizes by arguments within a render pass.
export const getCategoryPredictions = cache(async (cat: PredictionCategory) => {
  const today = lagosTodayBounds();
  const rows = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      kickoff: { gte: today.start, lt: today.end },
      ...(cat === "TODAY" ? {} : { categories: { some: { category: cat } } }),
    },
    // Deterministic, but not the order the page renders in — the ranking in
    // orderForDisplay decides that. This clause exists so the `take` below
    // always cuts the same 60 rows out of a larger day, rather than letting an
    // unordered query decide which ones the ranking never gets to see.
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } },
    take: 60,
  });
  return orderForDisplay(rows);
});
