/**
 * SEO landing-page indexability policy.
 *
 * The default URL for a substantive evergreen guide remains indexable even
 * on a quiet fixture day; dated/filter variants are browsing states, not
 * additional search landing pages. Paid categories and one-off selections
 * retain their separate publication/indexing rules.
 */
export const EVERGREEN_CATEGORIES = ["TODAY", "FEATURED", "GENIUS", "BANKER", "GOALS"] as const;
export const EVERGREEN_MARKET_HUBS = ["straight-wins", "double-chance", "btts", "over-2-5-goals"] as const;

export function isEvergreenCategory(category: string): boolean {
  return (EVERGREEN_CATEGORIES as readonly string[]).includes(category);
}

export function isEvergreenMarketHub(slug: string): boolean {
  return (EVERGREEN_MARKET_HUBS as readonly string[]).includes(slug);
}

/** Explicitly excludes VIP/Premium, one-off Bet of the Day and dated/filter feeds. */
export function shouldIndexCategoryFeed(
  category: string,
  day: string,
  hasFilters: boolean,
  hasPublishedPicks: boolean,
): boolean {
  if (day !== "today" || hasFilters) return false;
  if (category === "VIP" || category === "PREMIUM") return false;
  return isEvergreenCategory(category) || hasPublishedPicks;
}

/** These market pages contain substantive standalone explanations and settled evidence. */
export function shouldIndexMarketHub(day: string): boolean {
  return day === "today";
}

const EMPTY_DESCRIPTION: Record<string, string> = {
  TODAY: "Football predictions today with match analysis, market explanations and settled results. Published picks appear when the day's matches meet our selection criteria.",
  FEATURED: "Featured football betting tips with match reasoning, confidence context and a public record of results. New selections appear when published.",
  GENIUS: "Genius football tips selected from published matches, ranked by confidence and supported by match reasoning. View the method and past results.",
  BANKER: "Banker of the Day football predictions: a focused shortlist of higher-confidence picks with selection rules and historical results. Picks appear when available.",
  GOALS: "Over 1.5 goals and total-goals football predictions with scoring-market explanations, match evidence and published results.",
};

export function evergreenEmptyDescription(category: string): string | null {
  return EMPTY_DESCRIPTION[category] ?? null;
}
