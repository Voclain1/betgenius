import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { PredictionCategory } from "@/lib/enums";

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
};

export const CATEGORY_NAMES: Record<PredictionCategory, string> = {
  FEATURED: "Featured tips",
  GENIUS: "Genius tips",
  TODAY: "Today's predictions",
  BANKER: "Banker",
  VIP: "VIP tips",
  PREMIUM: "Premium tips",
};

export const CATEGORY_TO_SLUG = Object.fromEntries(
  Object.entries(CATEGORY_SLUGS).map(([slug, cat]) => [cat, slug]),
) as Record<PredictionCategory, string>;

// Shared between generateMetadata and the page body on /predictions/[category]
// (and now the dashboard) so a given category's predictions are only fetched
// once per request — React's cache() memoizes by arguments within a render pass.
export const getCategoryPredictions = cache(async (cat: PredictionCategory) => {
  return prisma.prediction.findMany({
    where: { status: "PUBLISHED", categories: { some: { category: cat } } },
    orderBy: { publishedAt: "desc" },
    include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } },
    take: 60,
  });
});
