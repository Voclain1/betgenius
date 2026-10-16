/**
 * The market pages: every published tip of the day in one market, from any
 * free category. VIP and Premium tips are left out (they belong to their
 * members' feeds), so these pages never show a locked row.
 *
 * One list, read by every place that links to them: the Tips menu, the chips
 * on the feed pages, the homepage line and the /predictions index. Client-safe
 * (no database), so the nav can import it.
 */

export type MarketHub = { key: MarketHubKey; href: string; label: string; desc: string };
export type MarketHubKey = "STRAIGHT_WIN" | "DOUBLE_CHANCE" | "BTTS" | "OVER_2_5";

export const MARKET_HUBS: readonly MarketHub[] = [
  {
    key: "STRAIGHT_WIN",
    href: "/predictions/straight-wins",
    label: "Straight Wins",
    desc: "Home win and away win picks: one team to win the match outright.",
  },
  {
    key: "DOUBLE_CHANCE",
    href: "/predictions/double-chance",
    label: "Double Chance",
    desc: "Home-or-Draw, Away-or-Draw and Home-or-Away picks with supporting evidence and settled results.",
  },
  {
    key: "BTTS",
    href: "/predictions/btts",
    label: "BTTS",
    desc: "Both Teams to Score Yes and No picks, with match evidence and the settled market record.",
  },
  {
    key: "OVER_2_5",
    href: "/predictions/over-2-5-goals",
    label: "Over 2.5",
    desc: "Matches assessed for at least three total goals, with the supporting evidence and settled record.",
  },
];

/** The paid tiers a market page leaves out. */
export const MARKET_HUB_EXCLUDED_CATEGORIES = ["VIP", "PREMIUM"] as const;

/** A straight win is a home or away win; a draw pick is not a win. Pure. */
export function isStraightWinSelection(selection: unknown): boolean {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) return false;
  const value = (selection as { value?: unknown }).value;
  return value === "HOME" || value === "AWAY";
}

/** True when a tip carries no VIP or Premium tag, primary or linked. Pure. */
export function isFreeTierRow(row: { category?: string | null; categories?: ReadonlyArray<{ category: string }> }): boolean {
  const paid = MARKET_HUB_EXCLUDED_CATEGORIES as readonly string[];
  if (row.category && paid.includes(row.category)) return false;
  return !(row.categories ?? []).some((c) => paid.includes(c.category));
}
