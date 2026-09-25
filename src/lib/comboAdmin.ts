/**
 * Admin review rules for assembled doubles (Combo Bets).
 *
 * Doubles used to be findable in admin mainly because generation also tagged
 * them FEATURED. Now that ordinary doubles are tagged SAME_GAME_DOUBLE only
 * (src/lib/comboQuota.ts), admin finds them by MARKET TYPE instead: the
 * "Combo Bets" filter matches marketType, which is exact, rather than the
 * SAME_GAME_DOUBLE tag, which the hidden source legs carry too.
 *
 * Editing a double also had to stop failing. The category editor only offers
 * the ordinary editorial categories, and SAME_GAME_DOUBLE is deliberately not
 * one of them. Like BET_OF_THE_DAY, it is a tag the editor never sends and a
 * save must never strip, so it is carried through instead of being accepted
 * as input. Ordinary rows keep the at-least-one-category rule.
 *
 * Pure: no database.
 */

export const COMBO_MARKET_TYPE = "SAME_GAME_DOUBLE" as const;

/** The admin list filter value for "Combo Bets". Not a category: it matches marketType. */
export const ADMIN_COMBO_FILTER = "COMBO_BETS" as const;

/** Tags the category editor never sends and a save must carry through. */
export const EDITOR_PRESERVED_TAGS = ["BET_OF_THE_DAY", "SAME_GAME_DOUBLE"] as const;

export const isComboPrediction = (row: { marketType?: string | null }): boolean => row.marketType === COMBO_MARKET_TYPE;

/** Does an admin list row match the category filter? "Combo Bets" matches assembled doubles only. */
export function matchesAdminCategoryFilter(
  row: { marketType?: string | null; category: string; categories?: { category: string }[] },
  filter: string,
): boolean {
  if (filter === "ALL") return true;
  if (filter === ADMIN_COMBO_FILTER) return isComboPrediction(row);
  return row.categories?.length ? row.categories.some((c) => c.category === filter) : row.category === filter;
}

/**
 * The categories a save writes: the editor's choice plus any preserved tag
 * the row already holds.
 *
 * An empty choice is accepted only for a row that holds SAME_GAME_DOUBLE (a
 * double, or one of its hidden legs), which still ends up with that tag and so
 * never with no category at all. Every other row still needs at least one.
 */
export function mergeEditedCategories(
  held: readonly string[],
  requested: readonly string[],
): { ok: true; categories: string[] } | { ok: false; error: string } {
  const preserved = held.filter((c) => (EDITOR_PRESERVED_TAGS as readonly string[]).includes(c));
  if (requested.length === 0 && !preserved.includes(COMBO_MARKET_TYPE)) {
    return { ok: false, error: "At least one category is required" };
  }
  return { ok: true, categories: [...new Set([...requested, ...preserved])] };
}

/**
 * A double's market is its two legs: fixed at assembly, and what settlement
 * reads. The market editor cannot express that, so edits to a double may not
 * carry market fields at all. Returns the error to send, or null.
 */
export function comboMarketEditError(
  isCombo: boolean,
  patch: { marketType?: unknown; selection?: unknown; otherMarket?: unknown; otherPick?: unknown; ouLine?: unknown; ouDirection?: unknown },
): string | null {
  if (!isCombo) return null;
  const touched = (["marketType", "selection", "otherMarket", "otherPick", "ouLine", "ouDirection"] as const).filter((k) => patch[k] !== undefined);
  return touched.length ? `A Combo Bet's market is its legs and can't be edited here (${touched.join(", ")})` : null;
}
