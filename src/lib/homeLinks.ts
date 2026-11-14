/**
 * The homepage's own links, as data: which destination each tracked link is,
 * and where on the page it sits. Pure and client-safe (no database).
 *
 * Only the words below ever reach analytics — never a label, a name or a URL
 * with a query — so a report can compare "hero" against "category_nav" without
 * carrying anything about the reader or a prediction.
 */

export type HomeTarget =
  | "today" | "banker" | "genius" | "featured" | "premium" | "vip" | "goals" | "multi_bet"
  | "weekend" | "midweek" | "genius_all" | "featured_all" | "bet_of_the_day"
  | "pricing" | "register" | "dashboard" | "saved"
  | "match_insights" | "livescores" | "bet_builder" | "statspad";

export type HomePlacement = "hero" | "category_nav" | "account_line" | "section" | "tools";

export const HOME_TARGETS: readonly HomeTarget[] = [
  "today", "banker", "genius", "featured", "premium", "vip", "goals", "multi_bet", "weekend", "midweek", "genius_all", "featured_all", "bet_of_the_day",
  "pricing", "register", "dashboard", "saved", "match_insights", "livescores", "bet_builder", "statspad",
];
export const HOME_PLACEMENTS: readonly HomePlacement[] = ["hero", "category_nav", "account_line", "section", "tools"];

const BY_HREF: Record<string, HomeTarget> = {
  "/predictions/today": "today",
  "/predictions/banker": "banker",
  "/predictions/genius": "genius",
  "/predictions/featured": "featured",
  "/predictions/premium": "premium",
  "/predictions/vip": "vip",
  "/predictions/goals": "goals",
  "/multi-bets": "multi_bet",
  "/predictions/weekend": "weekend",
  "/predictions/midweek": "midweek",
  "/predictions/bet-of-the-day": "bet_of_the_day",
  "/pricing": "pricing",
  "/register": "register",
  "/dashboard": "dashboard",
  "/dashboard/saved": "saved",
  "/match-insights": "match_insights",
  "/livescores": "livescores",
  "/bet-builder": "bet_builder",
  "/statspad": "statspad",
};

/** The analytics word for a homepage destination, or null for one that is not tracked. */
export function homeTargetFor(href: string): HomeTarget | null {
  return BY_HREF[href] ?? null;
}
