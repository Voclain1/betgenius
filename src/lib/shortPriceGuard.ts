import { findSelection, type FixtureOdds } from "@/lib/odds";

/**
 * Double Chance on a heavy favourite pays almost nothing: a 1.05 is useless to
 * a punter. When the market already prices a side to win under SHORT_WIN_MAX,
 * that side's Double Chance sits under SHORT_DC_MAX, so the generator is told
 * (shortPriceBlock) to back the win itself when the evidence supports it, or
 * find another market, and any Double Chance draft still priced under
 * SHORT_DC_MAX is dropped before it is saved (isUnpayableDoubleChance).
 *
 * Median prices, not best: the best quote is one bookmaker's outlier, the
 * median is what the market agrees on. Pure, so the rule is checked without a
 * database (scripts/check-short-price-guard.ts).
 */
export const SHORT_WIN_MAX = 1.22;
export const SHORT_DC_MAX = 1.1;

export type ShortPriceSide = { side: "HOME" | "AWAY"; team: string; win: number; doubleChance: number };

/** The sides priced so short that their Double Chance is not worth tipping. */
export function shortPriceSides(odds: FixtureOdds | null, home: string, away: string): ShortPriceSide[] {
  if (!odds) return [];
  const sides: ShortPriceSide[] = [];
  for (const s of [
    { side: "HOME" as const, team: home, win: "Home", dc: "Home/Draw" },
    { side: "AWAY" as const, team: away, win: "Away", dc: "Draw/Away" },
  ]) {
    const win = findSelection(odds, "Match Winner", s.win)?.median;
    const dc = findSelection(odds, "Double Chance", s.dc)?.median;
    if (win != null && dc != null && win < SHORT_WIN_MAX && dc < SHORT_DC_MAX) {
      sides.push({ side: s.side, team: s.team, win, doubleChance: dc });
    }
  }
  return sides;
}

/** The prompt section for a fixture with a short-priced favourite. Empty when there is none. */
export function shortPriceBlock(sides: readonly ShortPriceSide[]): string {
  if (sides.length === 0) return "";
  const lines = sides.map(
    (s) => `  - ${s.team} (${s.side.toLowerCase()}) to win: ${s.win.toFixed(2)}; ${s.team} or Draw (Double Chance): ${s.doubleChance.toFixed(2)}`,
  );
  return `
SHORT-PRICE RULE — READ BEFORE CHOOSING.

The bookmakers price this side as a heavy favourite (median across bookmakers):
${lines.join("\n")}

Double Chance on that side pays almost nothing and is useless to a punter. Do
NOT return DOUBLE_CHANCE for it. Instead, weigh the evidence for an outright
win: recent form (home or away as relevant), league position and goal
difference, head-to-head, and team news. If that evidence genuinely supports a
win, return MATCH_WINNER for that side with a confidence that reflects the
evidence. If it does not, return the next strongest pick with a real price:
DRAW_NO_BET on that side, WIN_EITHER_HALF, OVER_UNDER or BTTS, whichever the
evidence supports with the highest confidence. Never the Double Chance.
`;
}

/**
 * The second ask, when every draft came back an unpayable Double Chance: name
 * the prices that made them worthless and require the next strongest market.
 */
export function shortPriceRetryBlock(odds: FixtureOdds | null, drafts: readonly { selection: unknown }[], home: string, away: string): string {
  const label = (v?: string) => (v === "HOME_OR_DRAW" ? `${home} or Draw` : v === "AWAY_OR_DRAW" ? `${away} or Draw` : `${home} or ${away}`);
  const book = (v?: string) => (v === "HOME_OR_DRAW" ? "Home/Draw" : v === "AWAY_OR_DRAW" ? "Draw/Away" : "Home/Away");
  const lines = [...new Set(drafts.map((d) => (d.selection as { value?: string } | null)?.value))].map((v) => {
    const price = findSelection(odds, "Double Chance", book(v))?.median;
    return `  - ${label(v)}: ${price != null ? price.toFixed(2) : "under " + SHORT_DC_MAX.toFixed(2)}`;
  });
  return `
DOUBLE CHANCE IS NOT AVAILABLE FOR THIS MATCH — READ BEFORE CHOOSING.

The bookmakers price these Double Chance selections so short they pay almost
nothing (median across bookmakers):
${lines.join("\n")}

Do NOT return DOUBLE_CHANCE. Return the strongest pick with a real price, the
one the evidence supports with the highest confidence: MATCH_WINNER for the
favourite if form, table position and team news support a win; otherwise
DRAW_NO_BET, WIN_EITHER_HALF, OVER_UNDER, BTTS or TEAM_TOTAL. Give it the
confidence the evidence supports.
`;
}

/** A Double Chance pick whose own selection is priced under SHORT_DC_MAX. */
export function isUnpayableDoubleChance(odds: FixtureOdds | null, marketType: string, selection: unknown): boolean {
  if (!odds || marketType !== "DOUBLE_CHANCE") return false;
  const v = (selection as { value?: string } | null)?.value;
  const label = v === "HOME_OR_DRAW" ? "Home/Draw" : v === "AWAY_OR_DRAW" ? "Draw/Away" : v === "HOME_OR_AWAY" ? "Home/Away" : null;
  if (!label) return false;
  const price = findSelection(odds, "Double Chance", label)?.median;
  return price != null && price < SHORT_DC_MAX;
}

/** Thrown when every draft was an unpayable Double Chance: nothing worth saving. */
export class ShortPriceError extends Error {
  constructor(match: string) {
    super(`Only an unpayable Double Chance (under ${SHORT_DC_MAX.toFixed(2)}) was drafted for ${match}`);
    this.name = "ShortPriceError";
  }
}
