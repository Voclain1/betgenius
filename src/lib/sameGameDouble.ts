import type { Outcome } from "@/lib/enums";
import type { MarketType, Selection } from "@/lib/markets";

/**
 * Same-game doubles: two independently-generated picks on ONE fixture,
 * published as a single compound pick.
 *
 * This file is the whole decision layer and nothing else. It is pure — no
 * Prisma, no fetch, no clock — because both questions it answers are ones we
 * need to be able to assert against real historical data without a database:
 *
 *   1. may these two picks be combined at all?   -> checkLegCompatibility
 *   2. what did the combination settle as?       -> composeComboOutcome
 *
 * Deliberately NOT here: per-market settlement. A combo does not introduce a
 * new market type to resolve; it composes the results of two existing ones.
 * resolveMarket() in src/lib/markets.ts stays the only place a scoreline is
 * turned into an outcome, unchanged.
 */

export type Leg = { marketType: MarketType; selection: Selection };

/**
 * Why two picks cannot be combined.
 *
 * REDUNDANT is the one that matters in practice and the one that is easy to
 * miss: the picks are not in conflict, but one logically GUARANTEES the other,
 * so the pair is really just the stricter pick wearing a longer name. It looks
 * like a compound bet and adds no second condition. Real generated data bears
 * this out — 2 of the 3 fixtures that ever produced multiple markets paired
 * MATCH_WINNER Home with DOUBLE_CHANCE Home-or-Draw, which it already implies.
 *
 * CONTRADICTORY is the obvious one: the two picks cannot both be true.
 */
export type IncompatibilityReason = "CONTRADICTORY" | "REDUNDANT";

export type CompatibilityVerdict =
  | { ok: true }
  | { ok: false; reason: IncompatibilityReason; detail: string };

/** The side a pick backs, where it backs one — used to spot opposed picks. */
function backedSide(leg: Leg): "HOME" | "AWAY" | null {
  const sel = leg.selection as { value?: string } | null;
  if (leg.marketType === "MATCH_WINNER" || leg.marketType === "WIN_EITHER_HALF") {
    return sel?.value === "HOME" ? "HOME" : sel?.value === "AWAY" ? "AWAY" : null;
  }
  if (leg.marketType === "DOUBLE_CHANCE") {
    return sel?.value === "HOME_OR_DRAW" ? "HOME" : sel?.value === "AWAY_OR_DRAW" ? "AWAY" : null;
  }
  // OVER_UNDER, BTTS and CORRECT_SCORE make no claim about which side wins.
  return null;
}

/** Which match results a DOUBLE_CHANCE selection covers. Mirrors resolveMarket. */
const DOUBLE_CHANCE_COVERS: Record<string, string[]> = {
  HOME_OR_DRAW: ["HOME", "DRAW"],
  AWAY_OR_DRAW: ["AWAY", "DRAW"],
  HOME_OR_AWAY: ["HOME", "AWAY"],
};

/**
 * Whether two picks on the same fixture may be published as one double.
 *
 * Written as explicit named cases rather than a lookup table because several
 * of the rules depend on the SELECTION, not just the market type — BTTS Yes
 * with Over 2.5 is a real double, BTTS Yes with Over 1.5 is not, and a table
 * keyed on market types alone cannot express that difference.
 *
 * Order matters: the specific market-pair rules run before the general
 * opposed-sides check, so a rejection carries the most informative reason
 * rather than a generic one.
 */
export function checkLegCompatibility(a: Leg, b: Leg): CompatibilityVerdict {
  const pairIs = (x: MarketType, y: MarketType) =>
    (a.marketType === x && b.marketType === y) || (a.marketType === y && b.marketType === x);

  if (a.marketType === b.marketType) {
    return { ok: false, reason: "REDUNDANT", detail: `same marketType (${a.marketType}) twice` };
  }

  // An exact score already fixes the result, the goal total and whether both
  // teams scored, so every possible partner is implied by it or impossible
  // with it. There is no coherent pairing to look for.
  if (a.marketType === "CORRECT_SCORE" || b.marketType === "CORRECT_SCORE") {
    return { ok: false, reason: "REDUNDANT", detail: "CORRECT_SCORE already determines every other market" };
  }

  // Backing a side to win covers "that side or draw" and "either side", and
  // contradicts "the other side or draw". No combination of the two survives,
  // which is why this pair is rejected wholesale rather than case by case.
  if (pairIs("MATCH_WINNER", "DOUBLE_CHANCE")) {
    const mw = a.marketType === "MATCH_WINNER" ? a : b;
    const dc = a.marketType === "DOUBLE_CHANCE" ? a : b;
    const mwSide = (mw.selection as { value?: string } | null)?.value ?? "";
    const dcValue = (dc.selection as { value?: string } | null)?.value ?? "";
    return DOUBLE_CHANCE_COVERS[dcValue]?.includes(mwSide)
      ? { ok: false, reason: "REDUNDANT", detail: `${mwSide} already implies ${dcValue}` }
      : { ok: false, reason: "CONTRADICTORY", detail: `${mwSide} cannot occur within ${dcValue}` };
  }

  // Winning on aggregate means (h1-a1) + (h2-a2) > 0, so at least one of those
  // terms is positive: MATCH_WINNER strictly implies WIN_EITHER_HALF on the
  // same side. The opposite-sides case is genuinely possible — the away side
  // takes the first half, the home side takes the tie — but reads as
  // self-contradictory on a card, so it is excluded on presentation grounds.
  if (pairIs("MATCH_WINNER", "WIN_EITHER_HALF")) {
    const sideA = backedSide(a);
    const sideB = backedSide(b);
    return sideA && sideA === sideB
      ? { ok: false, reason: "REDUNDANT", detail: "winning the match implies winning at least one half" }
      : { ok: false, reason: "CONTRADICTORY", detail: "opposed sides across the result and half markets" };
  }

  // BTTS Yes means at least two goals were scored, which settles the low
  // over/under lines outright in one direction or the other.
  if (pairIs("BTTS", "OVER_UNDER")) {
    const btts = (a.marketType === "BTTS" ? a : b).selection as { value?: string } | null;
    const ou = (a.marketType === "OVER_UNDER" ? a : b).selection as { line?: number; direction?: string } | null;
    const line = Number(ou?.line);
    if (btts?.value === "YES" && Number.isFinite(line) && line <= 1.5) {
      return ou?.direction === "UNDER"
        ? { ok: false, reason: "CONTRADICTORY", detail: `BTTS Yes cannot occur with Under ${line}` }
        : { ok: false, reason: "REDUNDANT", detail: `BTTS Yes already implies Over ${line}` };
    }
  }

  // Anything still standing that backs both sides of the same fixture.
  const sideA = backedSide(a);
  const sideB = backedSide(b);
  if (sideA && sideB && sideA !== sideB) {
    return { ok: false, reason: "CONTRADICTORY", detail: `backs ${sideA} and ${sideB} in the same match` };
  }

  return { ok: true };
}

/**
 * The outcome of a double, from its two legs' outcomes.
 *
 * Returns null when the double is NOT YET settleable — either leg still
 * pending. Null is not an outcome; callers must leave the row alone rather
 * than writing anything.
 *
 * VOID is checked before LOST, so a VOID+LOST pair voids.
 *
 * VOID HANDLING, and why it differs from a real bookmaker: a book removes a
 * void leg and reduces the bet to the remaining condition, because the stake
 * has to go somewhere and the surviving legs still carry a payout. There is no
 * stake here. Reducing a published double to one leg would quietly turn it
 * into a different, easier pick than the one readers saw, and that pick would
 * then be scored in the strike-rate record — the one number this feature is
 * judged on. Voiding the whole thing is the honest reading: the pick as
 * published could not be evaluated.
 */
export function composeComboOutcome(a: Outcome, b: Outcome): Outcome | null {
  if (a === "PENDING" || b === "PENDING") return null;
  if (a === "VOID" || b === "VOID") return "VOID";
  if (a === "LOST" || b === "LOST") return "LOST";
  if (a === "WON" && b === "WON") return "WON";
  return null;
}

/**
 * The highest confidence a double can honestly claim.
 *
 * P(A and B) <= min(P(A), P(B)) holds for ANY two events, under every possible
 * correlation between them. So this is a true ceiling, not an estimate, and it
 * needs no independence assumption to state.
 *
 * Multiplying the two leg confidences is what NOT to do here. Legs on one
 * fixture are strongly correlated — both are drawn from a single AI analysis
 * of a single match, to the point where analysisJson is duplicated across the
 * rows of one job — so the product is not "approximately right", it is wrong
 * by an unknown amount in an unknown direction. Publishing it would be exactly
 * the fabricated precision the odds display was corrected for.
 *
 * Display this as "no better than N%", never as "N% combined".
 */
export function comboConfidenceCeiling(legAConfidence: number, legBConfidence: number): number {
  return Math.min(legAConfidence, legBConfidence);
}
