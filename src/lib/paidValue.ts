import type { PricedPick } from "@/lib/paidSelection";

/**
 * Value assessment for a paid pick. Pure: no database, no network.
 *
 * Three numbers are kept apart on purpose:
 *   - the model's CONFIDENCE (raw, as stated, never overwritten);
 *   - the MARKET-IMPLIED probability (de-vigged from the median quote);
 *   - the ESTIMATED probability (a fitted calibration, src/lib/calibration.ts)
 *     and the EXPECTED VALUE it implies at the price a reader can get.
 * The model's own confidence is never treated as proof of an edge: value is
 * only ever computed from a calibrated estimate, and judged on its lower bound.
 *
 * PRICE. The median across books, never the best: the best is one outlier
 * book a subscriber may not have. A price derived from another market (draw no
 * bet from the 1X2) is not an executable quote, so it is never valued.
 */

/** Win, void (stake returned) and loss probabilities for one selection. Sum to 1. */
export type OutcomeProbabilities = { win: number; void: number; loss: number };

/**
 * Expected return on one unit at decimal odds `odds`: win pays odds − 1, a void
 * returns the stake, a loss loses it. EV = pWin·odds + pVoid − 1.
 */
export function expectedReturn(p: OutcomeProbabilities, odds: number): number {
  return p.win * odds + p.void - 1;
}

/** The win probability at which `odds` breaks even, given the void probability: (1 − pVoid) / odds. */
export function breakEvenProbability(odds: number, pVoid = 0): number {
  return (1 - pVoid) / odds;
}

/**
 * Outcome probabilities for a market from its win probability. Every market a
 * paid pick can carry today settles win/lose except draw no bet, which voids on
 * a draw; for that the draw probability must be supplied (from the de-vigged 1X2).
 */
export function outcomeProbabilities(marketType: string, pWin: number, pDraw?: number | null): OutcomeProbabilities {
  if (marketType === "DRAW_NO_BET") {
    const v = Math.max(0, Math.min(1 - pWin, pDraw ?? 0));
    return { win: pWin, void: v, loss: Math.max(0, 1 - pWin - v) };
  }
  return { win: pWin, void: 0, loss: 1 - pWin };
}

export type ValueRejection =
  | "NO_EXECUTABLE_PRICE" // no usable quote, a market the feed does not price, or a derived price
  | "THIN_BOOK" // fewer than VALUE_MIN_BOOKMAKERS quote it
  | "PRICE_DISAGREEMENT" // the best book is far off the median: the price is not settled
  | "NO_CALIBRATION" // no active calibration artifact
  | "EV_NOT_CREDIBLE"; // the lower bound of expected value is under the bar

export const VALUE_MIN_BOOKMAKERS = 5;
/** Best price more than this far above the median marks a market that has not settled. */
export const VALUE_MAX_PRICE_SPREAD = 0.15;

export type ValueAssessment = {
  calibrationVersion: string | null;
  rawConfidence: number;
  marketProbability: number | null;
  estimatedProbability: number | null;
  /** Lower bound of the estimate: estimate − z·se, see uncertaintyLower. */
  estimatedProbabilityLower: number | null;
  odds: number | null;
  bookmakers: number | null;
  breakEven: number | null;
  expectedValue: number | null;
  expectedValueLower: number | null;
  eligible: boolean;
  reasons: ValueRejection[];
};

/** Lower bound of a probability estimate: p − z·max(se, seFloor), never below 0. */
export function uncertaintyLower(p: number, se: number, z = 1.28, seFloor = 0.02): number {
  return Math.max(0, p - z * Math.max(se, seFloor));
}

/**
 * Assess one candidate. `estimate` is the calibrated win probability (0-1) and
 * its standard error, or null when no active calibration exists. `minEvLower`
 * is the bar the lower-bound EV must clear (0 = "credibly not losing").
 */
export function assessValue(input: {
  marketType: string;
  rawConfidence: number;
  price: PricedPick | null;
  /** De-vigged draw probability (0-1), only needed for draw no bet. */
  pDraw?: number | null;
  estimate: { p: number; se: number; version: string } | null;
  minEvLower: number;
  z?: number;
}): ValueAssessment {
  const reasons: ValueRejection[] = [];
  const price = input.price && !input.price.derived ? input.price : null;
  if (!price) reasons.push("NO_EXECUTABLE_PRICE");
  if (price && price.bookmakers < VALUE_MIN_BOOKMAKERS) reasons.push("THIN_BOOK");
  if (price && price.best / price.median - 1 > VALUE_MAX_PRICE_SPREAD) reasons.push("PRICE_DISAGREEMENT");
  if (!input.estimate) reasons.push("NO_CALIBRATION");

  const odds = price?.median ?? null;
  const est = input.estimate?.p ?? null;
  const lower = input.estimate ? uncertaintyLower(input.estimate.p, input.estimate.se, input.z) : null;
  const pv = outcomeProbabilities(input.marketType, est ?? 0, input.pDraw).void;
  const ev = odds != null && est != null ? expectedReturn(outcomeProbabilities(input.marketType, est, input.pDraw), odds) : null;
  const evLower = odds != null && lower != null ? expectedReturn(outcomeProbabilities(input.marketType, lower, input.pDraw), odds) : null;
  if (evLower != null && evLower < input.minEvLower) reasons.push("EV_NOT_CREDIBLE");

  return {
    calibrationVersion: input.estimate?.version ?? null,
    rawConfidence: input.rawConfidence,
    marketProbability: price?.fair ?? null,
    estimatedProbability: est,
    estimatedProbabilityLower: lower,
    odds,
    bookmakers: price?.bookmakers ?? null,
    breakEven: odds != null ? breakEvenProbability(odds, pv) : null,
    expectedValue: ev,
    expectedValueLower: evLower,
    eligible: reasons.length === 0,
    reasons,
  };
}

/**
 * Rank and pick with a diversification cap: strongest lower-bound EV first,
 * then the estimate, then id for stability; at most `perMarketCap` picks of one
 * market type, so the feed is never one correlated bet repeated (for example
 * ten favourites' double chances, which all fail together on an upset-heavy
 * day). One pick per fixture is enforced by the caller's existing rule.
 */
export function rankByValue<T extends { id: string; marketType: string; value: ValueAssessment }>(
  rows: readonly T[],
  max: number,
  perMarketCap = Math.max(2, Math.ceil(max / 2)),
): T[] {
  const ranked = [...rows].sort(
    (a, b) =>
      (b.value.expectedValueLower ?? -Infinity) - (a.value.expectedValueLower ?? -Infinity) ||
      (b.value.estimatedProbability ?? 0) - (a.value.estimatedProbability ?? 0) ||
      a.id.localeCompare(b.id),
  );
  const perMarket = new Map<string, number>();
  const out: T[] = [];
  for (const r of ranked) {
    if (out.length >= max) break;
    const n = perMarket.get(r.marketType) ?? 0;
    if (n >= perMarketCap) continue;
    perMarket.set(r.marketType, n + 1);
    out.push(r);
  }
  return out;
}
