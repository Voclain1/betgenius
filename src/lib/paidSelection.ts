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

// ── Paid curation: which ordinary picks may stand in a paid feed ─────────────

/**
 * Model and market may differ by at most this many points for an ordinary pick
 * to be carried in a paid feed. It is the market-confirmation gate's own bar
 * (MC_MAX_GAP_PP), restated here so this module stays import-light; the check
 * script pins the two equal.
 *
 * WHY ORDINARY PAID PICKS NOW FACE IT. Dedicated paid picks always did; ordinary
 * curation only checked the model's confidence. Over 90 days of settled picks
 * (scripts/measure-paid-performance.ts, run 13 Nov 2026) the market was the
 * better forecaster wherever the two disagreed: priced singles the model put 5+
 * points above a 45–64% market lost 11–15% of stake, and VIP picks priced
 * 1.50–1.69 (market ~60%, model 75%+) won 15 of 30 for -21.9%. A paid pick the
 * market prices that far from the model is the model misreading the match, not
 * value. Using the existing bar rather than one tuned on that data keeps the
 * out-of-sample comparison honest.
 */
export const PAID_CURATION_MAX_GAP_PP = 10;

/** Books that must quote the selection before the market's view counts. Same as MC_MIN_BOOKMAKERS. */
export const PAID_CURATION_MIN_BOOKMAKERS = 5;

/**
 * A quote older than this is not read at curation time. Curation runs with
 * settlement every three hours and the odds workload re-prices published
 * fixtures hourly inside 24h, so six hours is two missed refreshes.
 */
export const PAID_CURATION_QUOTE_MAX_AGE_MS = 6 * 3_600_000;

export type PaidCurationVerdict =
  | { eligible: true; basis: "VIP_ROUTE" | "VIP_ROUTE_UNPRICED" | "WIDENED_MARKET_CONFIRMED"; gapPP: number | null }
  | { eligible: false; reason: "NOT_VIP_ROUTE" | "MODEL_MARKET_DISAGREE" | "WIDENED_UNPRICED" | "WIDENED_MARKET_BELOW_BAR" | "WIDENED_TOO_SHORT" | "WIDENED_THIN_BOOK"; gapPP: number | null };

/**
 * May this ordinary (non-dedicated) published pick be carried in a paid feed
 * whose confidence floor it already meets? Pure.
 *
 *   - A VIP-route pick (a core competition) is eligible as before, unless a
 *     usable quote shows the market more than PAID_CURATION_MAX_GAP_PP away
 *     from the model. With no usable quote it stays eligible: that is today's
 *     behaviour and its record (79.8% on 84 unpriced VIP picks) gives no reason
 *     to drop it.
 *   - On a thin day (the paid scope widened, see paidScopeFor) a pick from a
 *     widened competition is eligible only when the market confirms it on the
 *     dedicated pass's own terms: a usable quote from enough books, the market
 *     at or above `marketFloor` and no shorter than `maxMarketProbability`
 *     (PAID_MAX_MARKET_PROBABILITY), within the gap. Nothing about the bar is
 *     relaxed; only where a qualifying pick may come from.
 *
 * `price` must already be filtered for freshness and taken before kickoff by
 * the caller (null otherwise).
 */
export function assessPaidCuration(input: {
  confidence: number;
  vipRoute: boolean;
  /** The day's paid scope widened AND this pick's competition is in the widened scope. */
  widenedScope: boolean;
  price: PricedPick | null;
  marketFloor: number;
  maxMarketProbability: number;
}): PaidCurationVerdict {
  const fair = input.price && input.price.bookmakers >= PAID_CURATION_MIN_BOOKMAKERS ? input.price.fair : null;
  const gapPP = fair == null ? null : Math.abs(input.confidence - fair);
  if (input.vipRoute) {
    if (gapPP == null) return { eligible: true, basis: "VIP_ROUTE_UNPRICED", gapPP };
    if (gapPP > PAID_CURATION_MAX_GAP_PP) return { eligible: false, reason: "MODEL_MARKET_DISAGREE", gapPP };
    return { eligible: true, basis: "VIP_ROUTE", gapPP };
  }
  if (!input.widenedScope) return { eligible: false, reason: "NOT_VIP_ROUTE", gapPP };
  if (!input.price || input.price.fair == null) return { eligible: false, reason: "WIDENED_UNPRICED", gapPP };
  if (input.price.bookmakers < PAID_CURATION_MIN_BOOKMAKERS) return { eligible: false, reason: "WIDENED_THIN_BOOK", gapPP };
  if (input.price.fair < input.marketFloor) return { eligible: false, reason: "WIDENED_MARKET_BELOW_BAR", gapPP };
  if (input.price.fair > input.maxMarketProbability) return { eligible: false, reason: "WIDENED_TOO_SHORT", gapPP };
  if (gapPP! > PAID_CURATION_MAX_GAP_PP) return { eligible: false, reason: "MODEL_MARKET_DISAGREE", gapPP };
  return { eligible: true, basis: "WIDENED_MARKET_CONFIRMED", gapPP };
}

/** A usable quote for curation: fetched before kickoff and no older than PAID_CURATION_QUOTE_MAX_AGE_MS at `now`. */
export function usableCurationQuote(fetchedAt: Date | null | undefined, kickoff: Date | null | undefined, now: Date): boolean {
  if (!fetchedAt || !kickoff) return false;
  return fetchedAt.getTime() < kickoff.getTime() && now.getTime() - fetchedAt.getTime() <= PAID_CURATION_QUOTE_MAX_AGE_MS;
}
