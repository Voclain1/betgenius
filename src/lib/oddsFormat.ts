/**
 * How an ALREADY-AVAILABLE decimal price is written on screen.
 *
 * Presentation only. This never fetches, derives, rounds differently or
 * substitutes a price: BetGenius shows decimal odds to two places
 * (`toFixed(2)`, the convention every surface already used) and this file keeps
 * exactly that, adding one thing the call sites lacked — a price that is not a
 * valid decimal quote is treated as unavailable instead of being printed as
 * "NaN", "0.00" or "Infinity".
 *
 * A decimal price pays stake × odds, so a valid one is a finite number above
 * 1.00. (The odds engine uses the same `> 1` rule when it accepts a quote.)
 * Client-safe: no database, no React.
 */

/** The price as a number, or null when it is missing or not a valid decimal quote. Pure. */
export function validOdds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 1 ? value : null;
}

/** "1.85", or null when the price is missing or invalid. Pure. */
export function formatOdds(value: unknown): string | null {
  const v = validOdds(value);
  return v === null ? null : v.toFixed(2);
}
