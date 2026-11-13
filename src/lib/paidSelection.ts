import { findSelection, toBookmakerSelection, type FixtureOdds } from "@/lib/odds";
import { devigProbability, drawNoBetProbability } from "@/lib/marketConfirmed";

/**
 * Price and value arithmetic for one pick against a cached bookmaker quote.
 * Pure: no database, no network. Used by the paid pass's ranking, by the
 * performance audit (scripts/measure-paid-performance.ts) and by the backtest
 * (scripts/backtest-paid-selection.ts), so all three read a price the same way.
 */

export type PricedPick = {
  /** Median decimal price across the books quoting this exact selection. What a reader can realistically get. */
  median: number;
  /** Best decimal price on any book. An outlier by construction; shown, never used for ROI. */
  best: number;
  bookmakers: number;
  /** De-vigged market probability for the selection, 0-100, or null when the market is not fully quoted. */
  fair: number | null;
  /** True when no book quotes the selection directly and the price is derived (draw no bet from the 1X2). */
  derived: boolean;
};

/**
 * The quoted price for a structured pick, or null when the quote has no line
 * for it. Draw no bet has no stored market: its fair probability is the side's
 * share of the non-draw outcomes, and its price is that fair price shortened by
 * the 1X2 margin, the way a book builds it.
 */
export function pickPrice(odds: FixtureOdds | null | undefined, marketType: string, selection: unknown): PricedPick | null {
  if (!odds?.markets) return null;
  if (marketType === "DRAW_NO_BET") {
    const side = (selection as { value?: string } | null)?.value;
    const value = side === "HOME" ? "Home" : side === "AWAY" ? "Away" : null;
    if (!value) return null;
    const dnb = drawNoBetProbability(odds, value);
    const mw = odds.markets.find((m) => m.market === "Match Winner")?.selections ?? [];
    const overround = mw.reduce((s, x) => s + (x.median > 1 ? 1 / x.median : 0), 0);
    if (!dnb || !(dnb.probability > 0) || !(overround > 1)) return null;
    const price = Number((100 / dnb.probability / overround).toFixed(2));
    if (!(price > 1)) return null;
    return { median: price, best: price, bookmakers: dnb.bookmakers, fair: dnb.probability, derived: true };
  }
  const mapped = toBookmakerSelection(marketType, selection);
  if (!mapped) return null;
  const sel = findSelection(odds, mapped.market, mapped.value);
  if (!sel || !(sel.median > 1)) return null;
  const fair = devigProbability(odds, mapped.market, sel.value)?.probability ?? null;
  return { median: sel.median, best: sel.best, bookmakers: sel.bookmakers, fair, derived: false };
}

/**
 * Expected return of one unit at `price` if the true chance is `probability`
 * (0-100): p * price - 1. Positive only when the chance beats the price's own
 * implied probability. Stated in units per unit staked.
 */
export function expectedValue(probability: number, price: number): number {
  return (probability / 100) * price - 1;
}
