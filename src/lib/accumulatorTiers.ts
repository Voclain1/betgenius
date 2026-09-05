/**
 * Odds-tier accumulators: the selection logic, with no database and no I/O.
 *
 * Everything here is pure so the rules can be asserted directly (see
 * scripts/check-accumulator-tiers.ts) rather than only observed by running a
 * curation pass against live data. src/lib/accumulatorPipeline.ts owns the
 * reads, the writes and the cadence; this file owns "which legs, and is this
 * tier reachable at all".
 *
 * THE ONE THING THAT MAKES THIS DIFFERENT FROM SAME-GAME DOUBLES.
 *
 * A same-game double's problem is joint PROBABILITY across correlated legs:
 * two picks drawn from one AI analysis of one fixture, where multiplying the
 * confidences is wrong by an unknown amount in an unknown direction (see
 * comboConfidenceCeiling in src/lib/sameGameDouble.ts).
 *
 * Combined ODDS is not that. It is the payout multiple, and multiplying
 * decimal prices is precisely how a bookmaker defines an accumulator's return
 * — arithmetic on real quoted prices, not an estimate of anything. So this
 * feature computes and publishes a real combined price, and still refuses to
 * publish a joint confidence. Those are not in tension; they are different
 * quantities, and only one of them is knowable.
 *
 * Grounded in measurement, not assumption — see
 * scripts/research-accumulator-tiers.ts, whose findings are quoted inline
 * wherever they justify a constant.
 */
import { impliedProbability } from "@/lib/odds";

/**
 * The published ladder.
 *
 * Six rungs, low to high. The ladder is not arbitrary: measured over 10 days
 * of real published picks, 3x-20x were reachable on 11 of 11 days that had a
 * priced pool, and 50x on 10 of 11. That last gap is the point of the pool
 * gate below — 50x is the rung that legitimately comes up empty, and it must
 * be allowed to.
 */
export const ACCUMULATOR_TIERS = [3, 5, 10, 15, 20, 50] as const;
export type AccumulatorTier = (typeof ACCUMULATOR_TIERS)[number];

/**
 * A combination qualifies for tier T when its product lands in [T, T*BAND].
 *
 * 1.25 is measured, not chosen for roundness. Real landings across the sample
 * were 3.03, 5.33, 12.25, 15.75, 24.97 and 57.44 — the 10x and 20x rungs sit
 * near the TOP of this band, so tightening it is not free: it would push those
 * two into frequent misses. Never below T, because a "10x" that paid 9.4 would
 * be a worse promise than no tier at all.
 */
export const TIER_BAND = 1.25;

/**
 * Minimum confidence for any single leg.
 *
 * Measured: deep-priced legs already run min 60 / median 74, so a 60% floor is
 * a literal no-op. 65 is a real constraint that cost nothing across the whole
 * sample (every tier reachable on the same number of days as with no floor at
 * all). 70 costs one day in thirteen, at the 50x rung only.
 *
 * Worth stating plainly, because it inverts the intuition this feature was
 * questioned on: the high tiers are NOT reached by stacking long shots. Our
 * own published picks price at median 1.42 and p90 1.85, so long shots are not
 * available to stack. A 50x is reached by LEG COUNT — the measured example ran
 * six legs at 68-74% confidence and 1.87-2.05 each.
 */
export const TIER_CONFIDENCE_FLOOR = 65;

/**
 * Minimum usable legs before a tier is attempted at all.
 *
 * The one measured 50x failure came from a 15-leg pool whose best achievable
 * product was 35. Below roughly this size the search either fails outright or
 * succeeds by scraping the only combination that exists, which is not
 * selection — it is the absence of it. Standing the whole pass down is the
 * honest answer to a thin day.
 */
export const MIN_POOL_LEGS = 20;

/**
 * Ceiling on legs in one accumulator.
 *
 * Eight is already a long way past where a reader should be comfortable: six
 * legs at 70% each is a far longer shot than any single leg suggests. The
 * ceiling exists so a tier can fail rather than be reached by piling on legs
 * indefinitely.
 */
export const MAX_TIER_LEGS = 8;

/** Search budget, so a pathological pool cannot hang a curation pass. */
const SEARCH_NODE_BUDGET = 400_000;

/** One candidate leg: a published pick that resolved to a real, deep-quoted price. */
export type AccumulatorLeg = {
  predictionId: string;
  /** matchKey — the fixture identity. At most ONE leg per fixture may enter a combination. */
  fixture: string;
  matchLabel: string;
  market: string;
  pick: string;
  /** Best real price across bookmakers, as stored in FixtureOddsCache. Never estimated. */
  odds: number;
  /** How many books quote it — the depth bar is applied by the pipeline before a leg gets here. */
  bookmakers: number;
  confidence: number;
  /** Ranking input, lower is better, mirroring LEAGUE_PRIORITY_ORDER elsewhere. */
  leaguePriority: number;
};

/** Exact product of the leg prices — the accumulator's payout multiple. */
export function combinedOdds(legs: readonly AccumulatorLeg[]): number {
  return legs.reduce((product, leg) => product * leg.odds, 1);
}

/**
 * What the MARKET implies this accumulator's chance is, from its own price.
 *
 * This is the honest counterweight to a large multiplier, and it is not our
 * estimate of anything — it is the bookmakers' price restated as a percentage,
 * overround included. Publishing "x57.44" without it invites a reader to see
 * the upside and not the odds against; publishing a joint CONFIDENCE instead
 * would be inventing a number we cannot know. This is the one probability
 * figure on the card that is a fact rather than a claim.
 */
export function marketImpliedProbability(legs: readonly AccumulatorLeg[]): number {
  return impliedProbability(combinedOdds(legs));
}

/** True when a combination's product lands in the tier's band. */
export function landsInBand(product: number, tier: number): boolean {
  return product >= tier && product <= tier * TIER_BAND;
}

/**
 * The best combination for a tier, or null when the pool cannot reach it.
 *
 * Prefers FEWER LEGS above everything else. A 10x from three legs and a 10x
 * from seven pay the same and are not remotely the same bet; the short one is
 * strictly the better product, so leg count is the outer loop rather than a
 * tiebreak. Within a leg count, the combination whose weakest leg is strongest
 * wins — an accumulator is only as sound as the pick most likely to break it —
 * and league priority breaks the remaining ties so the result is deterministic
 * rather than dependent on row order.
 *
 * The search is a depth-first walk over legs sorted by descending price with a
 * hard product ceiling. Because every price exceeds 1, a running product that
 * has passed the band's top can never come back down, so that entire subtree
 * is dead and is cut — which is what keeps this a fast search over ~50 legs
 * rather than an enumeration of their power set.
 *
 * At most one leg per fixture, always. Two legs on one match are correlated
 * (the same reason same-game doubles need their own compatibility rules) and
 * bookmakers refuse to combine them, so an accumulator containing both would
 * be unplaceable as well as mispriced.
 */
export function findTierCombination(
  pool: readonly AccumulatorLeg[],
  tier: number,
  options: { confidenceFloor?: number; maxLegs?: number } = {},
): AccumulatorLeg[] | null {
  const floor = options.confidenceFloor ?? TIER_CONFIDENCE_FLOOR;
  const maxLegs = options.maxLegs ?? MAX_TIER_LEGS;

  const eligible = [...pool]
    .filter((leg) => leg.confidence >= floor)
    .sort((a, b) => b.odds - a.odds || a.leaguePriority - b.leaguePriority || a.predictionId.localeCompare(b.predictionId));

  const ceiling = tier * TIER_BAND;

  for (let legs = 2; legs <= maxLegs; legs++) {
    let best: AccumulatorLeg[] | null = null;
    let bestFloor = -1;
    let bestPriority = Number.POSITIVE_INFINITY;
    let budget = SEARCH_NODE_BUDGET;

    const walk = (start: number, chosen: AccumulatorLeg[], product: number, fixtures: Set<string>) => {
      if (budget-- <= 0) return;
      if (chosen.length === legs) {
        if (!landsInBand(product, tier)) return;
        const weakest = Math.min(...chosen.map((c) => c.confidence));
        const priority = chosen.reduce((sum, c) => sum + c.leaguePriority, 0);
        if (weakest > bestFloor || (weakest === bestFloor && priority < bestPriority)) {
          bestFloor = weakest;
          bestPriority = priority;
          best = [...chosen];
        }
        return;
      }
      for (let i = start; i < eligible.length; i++) {
        const leg = eligible[i];
        const next = product * leg.odds;
        // Sorted descending, so this leg is the largest remaining; if it alone
        // overshoots, a later smaller one may still fit — hence `continue`,
        // not `break`.
        if (next > ceiling) continue;
        if (fixtures.has(leg.fixture)) continue;
        chosen.push(leg);
        fixtures.add(leg.fixture);
        walk(i + 1, chosen, next, fixtures);
        fixtures.delete(leg.fixture);
        chosen.pop();
      }
    };

    walk(0, [], 1, new Set());
    if (best) return best;
  }

  return null;
}

/**
 * Which category gates each tier, and therefore who may read it.
 *
 * The low rungs are the shop window: a 3x built from two ~1.7 favourites is
 * the product demonstrating itself, and putting it behind a paywall would sell
 * the least interesting thing on the page. FEATURED is public (see
 * canViewCategory), so those three are open.
 *
 * The high rungs are gated as VIP, which canViewCategory admits for a VIP or a
 * PREMIUM subscriber — the literal reading of "15x/20x/50x require VIP or
 * Premium". Note that this deliberately does NOT put 50x behind PREMIUM alone:
 * that would be a further restriction than was asked for, and splitting the
 * three high rungs across two paywalls needs a product reason rather than a
 * technical one. See the note in the report if that split is wanted.
 */
export const TIER_CATEGORY: Record<number, "FEATURED" | "VIP"> = {
  3: "FEATURED",
  5: "FEATURED",
  10: "FEATURED",
  15: "VIP",
  20: "VIP",
  50: "VIP",
};

/** Reader-facing name for a tier. */
export function tierLabel(tier: number): string {
  return `${tier}x Accumulator`;
}

/**
 * The card's one-line description.
 *
 * States the leg count and the real combined price, and nothing about how
 * likely it is — the market-implied figure is rendered separately, where it
 * can be labelled as the market's number rather than ours.
 */
export function tierDescription(legs: readonly AccumulatorLeg[]): string {
  const product = combinedOdds(legs);
  return `${legs.length} legs across ${legs.length} fixtures, combining to ${product.toFixed(2)} at best available prices.`;
}
