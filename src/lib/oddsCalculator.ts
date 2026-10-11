/**
 * The maths behind /odds-calculator (SEO-403). Pure, so every figure the
 * page shows is checked in scripts/check-seo.ts.
 *
 * Nothing here predicts anything. It turns a price into the probability the
 * price implies, and removes a market's margin to show the bookmaker's fair
 * view, the same normalisation src/lib/marketConfirmed.ts applies to
 * published picks.
 */

/**
 * A price in any common format, as decimal odds, or null when it is not a
 * price. Decimal "2.5", fractional "6/4", American "+150" / "-200".
 * Decimal odds must be above 1: at 1.00 nothing is won.
 */
export function parseOdds(input: string): number | null {
  const raw = input.trim().replace(/\s+/g, "");
  if (!raw) return null;
  const fractional = raw.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (fractional) {
    const [num, den] = [Number(fractional[1]), Number(fractional[2])];
    return den > 0 && num > 0 ? 1 + num / den : null;
  }
  const american = raw.match(/^([+-])(\d+(?:\.\d+)?)$/);
  if (american) {
    const n = Number(american[2]);
    if (!(n >= 100)) return null;
    return american[1] === "+" ? 1 + n / 100 : 1 + 100 / n;
  }
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const decimal = Number(raw);
  return decimal > 1 ? decimal : null;
}

/** The probability a decimal price implies, 0–1. Also the win rate needed to break even at that price. */
export function impliedProbability(decimal: number): number {
  return 1 / decimal;
}

/** Total return and profit on a stake at a decimal price. */
export function returnOn(stake: number, decimal: number): { total: number; profit: number } {
  return { total: stake * decimal, profit: stake * (decimal - 1) };
}

export type MarketView = {
  /** Sum of implied probabilities, e.g. 1.048 for a 4.8% margin. */
  book: number;
  /** book - 1: the bookmaker's margin, 0.048 for 4.8%. */
  margin: number;
  /** Each outcome's probability with the margin removed; they sum to 1. */
  fair: number[];
  /** The decimal price each fair probability corresponds to. */
  fairOdds: number[];
};

/**
 * A complete market (every outcome priced: 1X2, or both sides of a two-way
 * market) with its margin divided out proportionally.
 */
export function marketView(decimals: number[]): MarketView | null {
  if (decimals.length < 2 || decimals.some((d) => !(d > 1))) return null;
  const implied = decimals.map(impliedProbability);
  const book = implied.reduce((sum, p) => sum + p, 0);
  const fair = implied.map((p) => p / book);
  return { book, margin: book - 1, fair, fairOdds: fair.map((p) => 1 / p) };
}
