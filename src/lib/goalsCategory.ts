import { isValidSelection } from "@/lib/markets";

/**
 * The Goals feed: Over 1.5 and Over 2.5 total match goals, and nothing else.
 *
 * DERIVED, NEVER CHOSEN. Unlike every other editorial tag, no person and no
 * ranking decides which rows carry GOALS. It is a fact about the row's
 * structured market, recomputed on every category write by
 * setPredictionCategories (src/lib/predictions.ts), so a market edit or a
 * rewrite that changes the market adds or removes it with no separate step.
 * That is also why the admin editors cannot tick it.
 *
 * Read from marketType + selection, never from display text. Every row also
 * carries a secondary ouLine/ouDirection, and a pick string like
 * "Over 2.5 Goals" can appear on a TEAM_TOTAL or inside a combo's label —
 * neither is a total-goals prediction, and a string match would take both.
 *
 * Same-game-double SOURCE LEGS are excluded even when their market qualifies.
 * They are hidden settlement inputs, kept out of every feed so one fixture
 * never appears as three loose picks (see getCategoryPredictions). The double
 * itself is marketType SAME_GAME_DOUBLE, so it never qualifies either.
 *
 * NOT a generation target. Measured over 12–25 Sep 2026: 2.7 public Over 2.5
 * singles/day (38 in 14 days, five zero days) and no public Over 1.5 single at
 * all. Anything that would raise supply is a separate decision; this file only
 * classifies what already exists.
 */
export const GOALS = "GOALS" as const;

/** The only total-goals lines the feed takes. Over 3.5+ is a different, rarer proposition. */
export const GOALS_LINES = [1.5, 2.5] as const;

const SAME_GAME_DOUBLE = "SAME_GAME_DOUBLE";

/** Is this a structured Over 1.5 or Over 2.5 total-goals prediction? */
export function isGoalsPrediction(marketType: string | null | undefined, selection: unknown): boolean {
  if (marketType !== "OVER_UNDER" || !isValidSelection("OVER_UNDER", selection)) return false;
  const s = selection as { line: number; direction: string };
  return s.direction === "OVER" && (GOALS_LINES as readonly number[]).includes(s.line);
}

export type GoalsMarket = { marketType: string | null | undefined; selection: unknown };

/**
 * The category list with GOALS set exactly when the market qualifies.
 *
 * Whatever the caller passed for GOALS is discarded and recomputed, so a stale
 * list read before a market edit cannot carry the tag forward. GOALS always
 * goes LAST: `categories[0]` becomes the row's primary `category`, and a
 * derived tag should never displace the editorial one a row was published
 * under.
 */
export function withGoalsCategory(categories: readonly string[], market: GoalsMarket): string[] {
  const rest = [...new Set(categories)].filter((c) => c !== GOALS);
  const qualifies = isGoalsPrediction(market.marketType, market.selection) && !rest.includes(SAME_GAME_DOUBLE);
  return qualifies ? [...rest, GOALS] : rest;
}

/**
 * Belt and braces for the feed query: whatever the tag says, only a row whose
 * market qualifies is shown. A tag can only disagree with the market if
 * something wrote categories without going through setPredictionCategories.
 */
export function goalsFeedRows<T extends { marketType: string; selection: unknown; categories?: { category: string }[] }>(rows: readonly T[]): T[] {
  return rows.filter(
    (r) => isGoalsPrediction(r.marketType, r.selection) && !(r.categories ?? []).some((c) => c.category === SAME_GAME_DOUBLE),
  );
}
