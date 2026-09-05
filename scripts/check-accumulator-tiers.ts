/**
 * Asserts the odds-tier accumulator selection rules.
 *
 * The failure modes here are all "published something the day's prices did not
 * support" — a tier forced into existence by relaxing a bound, a combination
 * that pairs two legs from one fixture, a joint probability invented from leg
 * confidences. None of those are visible in a screenshot of a working card, so
 * the rules live in a pure module (src/lib/accumulatorTiers.ts) and are
 * asserted directly here.
 *
 * Run: npx tsx scripts/check-accumulator-tiers.ts
 */
import {
  ACCUMULATOR_TIERS,
  MAX_TIER_LEGS,
  MIN_POOL_LEGS,
  TIER_BAND,
  TIER_CATEGORY,
  TIER_CONFIDENCE_FLOOR,
  combinedOdds,
  findTierCombination,
  landsInBand,
  marketImpliedProbability,
  tierDescription,
  tierLabel,
  type AccumulatorLeg,
} from "../src/lib/accumulatorTiers";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, Object.is(actual, expected), Object.is(actual, expected) ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
const near = (label: string, actual: number, expected: number, tol = 1e-9) =>
  check(label, Math.abs(actual - expected) < tol, `got ${actual}, want ~${expected}`);

let seq = 0;
const leg = (odds: number, confidence = 75, fixture?: string): AccumulatorLeg => {
  seq++;
  return {
    predictionId: `p${seq}`,
    fixture: fixture ?? `f${seq}`,
    matchLabel: `Team ${seq} vs Other ${seq}`,
    market: "Match Winner",
    pick: `Team ${seq} to win`,
    odds,
    bookmakers: 9,
    confidence,
    leaguePriority: 5,
  };
};

console.log("combined odds — arithmetic on real prices, not an estimate:");
near("two legs multiply", combinedOdds([leg(2), leg(3)]), 6);
near("six legs multiply", combinedOdds([leg(2), leg(2), leg(2), leg(2), leg(2), leg(2)]), 64);
near("an empty accumulator is 1", combinedOdds([]), 1);
// The market's own price restated. Not our confidence in anything.
near("market-implied probability is 1/product as a percentage", marketImpliedProbability([leg(2), leg(2)]), 25, 1e-6);

console.log("\ntier bands — [T, T*1.25], never below T:");
eq("band constant", TIER_BAND, 1.25);
check("exactly T qualifies", landsInBand(10, 10));
check("top of band qualifies", landsInBand(12.5, 10));
check("just under T does not", !landsInBand(9.99, 10));
check("just over the band does not", !landsInBand(12.51, 10));
// A "10x" that paid 9.4 would be a worse promise than no tier at all.
check("a shortfall is never accepted", !landsInBand(9.4, 10));

console.log("\nsearch — finds a real combination and respects the band:");
{
  const pool = [leg(2.0), leg(1.9), leg(1.8), leg(1.7), leg(1.6), leg(1.5), leg(1.4)];
  for (const tier of [3, 5, 10]) {
    const combo = findTierCombination(pool, tier);
    check(`${tier}x found`, combo !== null);
    if (combo) {
      const product = combinedOdds(combo);
      check(`${tier}x lands in band`, landsInBand(product, tier), `product ${product.toFixed(3)}`);
      check(`${tier}x legs all clear the floor`, combo.every((l) => l.confidence >= TIER_CONFIDENCE_FLOOR));
    }
  }
}

console.log("\nfewest legs wins — a 10x from 3 legs is not the same bet as a 10x from 7:");
{
  // 2.5 * 4.0 = 10 exactly, alongside a pile of small legs that could also
  // reach 10 with more of them. The pair must win.
  const pool = [leg(4.0), leg(2.5), leg(1.2), leg(1.2), leg(1.2), leg(1.2), leg(1.2), leg(1.2), leg(1.2)];
  const combo = findTierCombination(pool, 10);
  eq("takes the 2-leg solution", combo?.length, 2);
}

console.log("\nstrongest weakest-leg wins within a leg count:");
{
  // Two exact 10x pairs; the one whose weaker leg is stronger must be chosen.
  const pool = [leg(2.5, 90), leg(4.0, 88), leg(2.5, 70), leg(4.0, 70)];
  const combo = findTierCombination(pool, 10);
  eq("picks the higher-floor pair", combo ? Math.min(...combo.map((c) => c.confidence)) : null, 88);
}

console.log("\nconfidence floor — legs below it are not eligible at any tier:");
{
  const pool = [leg(2.5, 64), leg(4.0, 64), leg(2.5, 90), leg(4.0, 90)];
  const combo = findTierCombination(pool, 10);
  check("sub-floor legs excluded", combo !== null && combo.every((l) => l.confidence >= TIER_CONFIDENCE_FLOOR));
  const none = findTierCombination([leg(2.5, 60), leg(4.0, 60)], 10);
  eq("a pool entirely below the floor yields nothing", none, null);
  // A floor that admitted the pool's own minimum would not be a floor.
  eq("floor is 65", TIER_CONFIDENCE_FLOOR, 65);
}

console.log("\none leg per fixture — two picks on one match are correlated and unplaceable:");
{
  const shared = "same-fixture";
  // 2.5 * 4.0 = 10.00 EXACTLY and both sit on one fixture, so it is the most
  // tempting pair in the pool. The distinct-fixture 3.2 * 3.3 = 10.56 is the
  // only legitimate answer, and taking it means the correlated pair was
  // rejected on identity rather than merely outranked on price.
  const pool = [leg(2.5, 90, shared), leg(4.0, 90, shared), leg(3.2, 90), leg(3.3, 90)];
  const combo = findTierCombination(pool, 10);
  check("a valid distinct-fixture combination is found", combo !== null);
  check("never pairs two legs from one fixture", combo !== null && new Set(combo.map((c) => c.fixture)).size === combo.length);
  check("did not take the exact-10.00 correlated pair", !combo?.some((c) => c.fixture === shared));
  // With ONLY the correlated pair available, the tier must come up empty
  // rather than pairing them.
  eq("a tier reachable only by correlated legs is empty", findTierCombination([leg(2.5, 90, shared), leg(4.0, 90, shared)], 10), null);
}

console.log("\nunreachable tiers come up EMPTY rather than being forced:");
{
  // Eight legs at 1.7: 1.7^6 = 24.14 lands inside [20, 25], but 1.7^7 = 41.03
  // is short of 50 and 1.7^8 = 69.76 overshoots [50, 62.5]. So this pool can
  // reach 20x and genuinely cannot reach 50x — the exact situation a thin
  // real day produces, and the tier must go empty rather than stretch.
  const thin = Array.from({ length: 8 }, () => leg(1.7, 90));
  const combo20 = findTierCombination(thin, 20);
  check("20x is reachable from this pool", combo20 !== null, `product ${combo20 ? combinedOdds(combo20).toFixed(2) : "n/a"}`);
  check("reachable tier respects the leg ceiling", (combo20?.length ?? 0) <= MAX_TIER_LEGS);
  eq("50x is EMPTY rather than forced past its band", findTierCombination(thin, 50), null);
  // A pool of purely short prices cannot reach the top of the ladder at all.
  const shorter = Array.from({ length: 8 }, () => leg(1.5, 90));
  eq("50x unreachable from a 1.5-priced pool too", findTierCombination(shorter, 50), null);
}

console.log("\nleg ceiling is enforced:");
{
  const many = Array.from({ length: 30 }, () => leg(1.3, 90));
  const combo = findTierCombination(many, 50);
  // 1.3^8 = 8.16, far below 50 — so this must be empty, not a 20-leg monster.
  eq("no combination exceeds the ceiling to reach a tier", combo, null);
}

console.log("\ngating — the low rungs are the shop window, the high rungs are paid:");
eq("tiers", ACCUMULATOR_TIERS.join(","), "3,5,10,15,20,50");
for (const t of [3, 5, 10]) eq(`${t}x is FEATURED (public)`, TIER_CATEGORY[t], "FEATURED");
for (const t of [15, 20, 50]) eq(`${t}x is VIP (VIP or Premium subscriber)`, TIER_CATEGORY[t], "VIP");
check("every tier has a category", ACCUMULATOR_TIERS.every((t) => TIER_CATEGORY[t] !== undefined));

console.log("\npool gate:");
eq("minimum pool legs", MIN_POOL_LEGS, 20);

console.log("\nNO fabricated joint probability anywhere in the feature:");
{
  // The one probability figure published is 1/product — a restatement of the
  // bookmakers' price. Nothing multiplies or averages leg CONFIDENCES.
  const sources = ["src/lib/accumulatorTiers.ts", "src/lib/accumulatorPipeline.ts", "src/components/ComboCard.tsx"].map((f) =>
    readFileSync(join(__dirname, "..", f), "utf8"),
  );
  const joined = sources.join("\n");
  // Strip comments before scanning: the files DISCUSS joint probability at
  // length, and matching prose would be a false positive on every run.
  const code = joined.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  check("no confidence is multiplied into another", !/confidence\s*\*\s*|\*\s*\w*[Cc]onfidence/.test(code));
  check("no combined/joint confidence identifier exists", !/(joint|combined)[A-Za-z]*[Cc]onfidence/i.test(code));
  const card = readFileSync(join(__dirname, "..", "src/components/ComboCard.tsx"), "utf8");
  check("the card renders combined ODDS", card.includes("combined odds"));
  check("the card labels the probability as the MARKET's", card.includes("Market prices this at"));
  check("the card shows no combined confidence", !/combined confidence/i.test(card));
}

console.log("\ncopy:");
eq("tier label", tierLabel(10), "10x Accumulator");
{
  const d = tierDescription([leg(2), leg(3)]);
  check("description states leg count and real product", d.includes("2 legs") && d.includes("6.00"), d);
  check("description claims no probability", !/%/.test(d), d);
}

console.log(failures === 0 ? "\nAll accumulator checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
