/**
 * Short-price rule (src/lib/shortPriceGuard.ts): a side priced under 1.22 to
 * win with its Double Chance under 1.10 gets no Double Chance tip; the model is
 * told to back the win when the evidence supports it. Pure, no database.
 *
 * Run: npx tsx scripts/check-short-price-guard.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shortPriceSides, shortPriceBlock, shortPriceRetryBlock, isUnpayableDoubleChance } from "../src/lib/shortPriceGuard";
import { AUTO_MIN_MEDIAN_ODDS, automaticOddsFailure, automaticOddsRetryBlock } from "../src/lib/autoOddsFloor";
import { bulkFailureReason } from "../src/lib/generation/bulkRun";
import type { FixtureOdds } from "../src/lib/odds";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}

const sel = (value: string, median: number) => ({ value, best: median + 0.02, median, bookmakers: 8, bestBookmaker: "x" });
const odds = (home: number, away: number, homeDc: number, awayDc: number, eitherDc = 1.3): FixtureOdds =>
  ({
    bookmakerCount: 8,
    update: null,
    markets: [
      { market: "Match Winner", selections: [sel("Home", home), sel("Draw", 6), sel("Away", away)] },
      { market: "Double Chance", selections: [sel("Home/Draw", homeDc), sel("Home/Away", eitherDc), sel("Draw/Away", awayDc)] },
    ],
  }) as unknown as FixtureOdds;

// Side detection: both thresholds must hold.
const heavyHome = shortPriceSides(odds(1.15, 15, 1.04, 4.5), "Bayern", "Bochum");
check("home 1.15 / DC 1.04 is short-priced", heavyHome.length === 1 && heavyHome[0].side === "HOME" && heavyHome[0].team === "Bayern", heavyHome);
const heavyAway = shortPriceSides(odds(13, 1.2, 4.2, 1.06), "Ipswich", "Man City");
check("away 1.20 / DC 1.06 is short-priced", heavyAway.length === 1 && heavyAway[0].side === "AWAY", heavyAway);
check("home 1.30 / DC 1.12 is not", shortPriceSides(odds(1.3, 9, 1.12, 3.5), "A", "B").length === 0);
check("win 1.22 exactly is not (strictly under)", shortPriceSides(odds(1.22, 12, 1.05, 4), "A", "B").length === 0);
check("short win but DC 1.10 is not", shortPriceSides(odds(1.2, 12, 1.1, 4), "A", "B").length === 0);
check("no odds: nothing", shortPriceSides(null, "A", "B").length === 0);

// Prompt block.
check("no short side: empty block", shortPriceBlock([]) === "");
const block = shortPriceBlock(heavyHome);
check("block names the team and both prices", /Bayern/.test(block) && /1\.15/.test(block) && /1\.04/.test(block), block);
check("block forbids DOUBLE_CHANCE and offers MATCH_WINNER on evidence", /Do\s+NOT return DOUBLE_CHANCE/.test(block) && /MATCH_WINNER/.test(block) && /evidence/.test(block));

// Draft filter.
const o = odds(1.15, 15, 1.04, 4.5, 1.08);
check("DC HOME_OR_DRAW at 1.04 is unpayable", isUnpayableDoubleChance(o, "DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }));
check("DC HOME_OR_AWAY at 1.08 is unpayable", isUnpayableDoubleChance(o, "DOUBLE_CHANCE", { value: "HOME_OR_AWAY" }));
check("DC AWAY_OR_DRAW at 4.50 is kept", !isUnpayableDoubleChance(o, "DOUBLE_CHANCE", { value: "AWAY_OR_DRAW" }));
check("MATCH_WINNER is never filtered", !isUnpayableDoubleChance(o, "MATCH_WINNER", { value: "HOME" }));
check("no odds: nothing filtered", !isUnpayableDoubleChance(null, "DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }));

// Universal automatic price floor: test every quoted selection using its
// median, not the best outlier quote. Unpriced TEAM_TOTAL is held by design.
const lowMarkets = {
  ...odds(1.11, 8, 1.11, 3),
  markets: [
    ...odds(1.11, 8, 1.11, 3).markets,
    { market: "Goals Over/Under", selections: [sel("Under 2.5", 1.04), sel("Over 2.5", 1.30)] },
    { market: "Both Teams Score", selections: [sel("Yes", 1.09), sel("No", 3.70)] },
  ],
} as FixtureOdds;
check("auto minimum is 1.12", AUTO_MIN_MEDIAN_ODDS === 1.12);
check("match winner 1.11 rejected", automaticOddsFailure(lowMarkets, "MATCH_WINNER", { value: "HOME" })?.reason === "BELOW_MINIMUM_ODDS");
check("Double Chance 1.11 rejected", automaticOddsFailure(lowMarkets, "DOUBLE_CHANCE", { value: "HOME_OR_DRAW" })?.reason === "BELOW_MINIMUM_ODDS");
check("Under 2.5 total goals 1.04 rejected", automaticOddsFailure(lowMarkets, "OVER_UNDER", { line: 2.5, direction: "UNDER" })?.median === 1.04);
check("BTTS 1.09 rejected", automaticOddsFailure(lowMarkets, "BTTS", { value: "YES" })?.reason === "BELOW_MINIMUM_ODDS");
check("Over 2.5 1.30 allowed", automaticOddsFailure(lowMarkets, "OVER_UNDER", { line: 2.5, direction: "OVER" }) === null);
check("1.12 exactly allowed", automaticOddsFailure(odds(1.12, 8, 1.12, 3), "DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }) === null);
check("unpriced team total held, even with no cache", automaticOddsFailure(null, "TEAM_TOTAL", { side: "AWAY", line: 2.5, direction: "UNDER" })?.reason === "TEAM_TOTAL_UNPRICED");
check("unmapped odds are not misrepresented as verified", automaticOddsFailure(null, "WIN_EITHER_HALF", { value: "HOME" }) === null);
const newRetry = automaticOddsRetryBlock([
  automaticOddsFailure(lowMarkets, "OVER_UNDER", { line: 2.5, direction: "UNDER" })!,
  automaticOddsFailure(null, "TEAM_TOTAL", { side: "HOME", line: 2.5, direction: "UNDER" })!,
]);
check("floor retry names a real quote and rejects unverified team totals", /1\.04/.test(newRetry) && /TEAM_TOTAL/.test(newRetry) && /1\.12/.test(newRetry), newRetry);

// The second ask names the worthless prices and the alternatives.
const retryBlock = shortPriceRetryBlock(o, [{ selection: { value: "HOME_OR_DRAW" } }], "Real Madrid", "RB Leipzig");
check("retry ask names the Double Chance price", /Real Madrid or Draw: 1\.04/.test(retryBlock), retryBlock);
check("retry ask forbids Double Chance and lists Draw No Bet, Win Either Half, Match Winner", /Do NOT return DOUBLE_CHANCE/.test(retryBlock) && /DRAW_NO_BET/.test(retryBlock) && /WIN_EITHER_HALF/.test(retryBlock) && /MATCH_WINNER/.test(retryBlock));
check("first-ask block also offers Draw No Bet and Win Either Half", /DRAW_NO_BET/.test(block) && /WIN_EITHER_HALF/.test(block));

// Bulk panel wording.
check("bulk panel explains ShortPriceError", /Double Chance/.test(bulkFailureReason(Object.assign(new Error("x"), { name: "ShortPriceError" }))));
check("bulk panel explains AutoOddsFloorError", /1\.12/.test(bulkFailureReason(Object.assign(new Error("x"), { name: "AutoOddsFloorError" }))));

// Wiring.
const gen = readFileSync(join(__dirname, "../src/lib/ai/generate.ts"), "utf8");
check("generate.ts passes shortPriceBlock to the model", /const firstBlock = shortPriceBlock\(shortPriceSides\(priceOdds, input\.home, input\.away\)\);/.test(gen) && /callModel\(firstBlock\)/.test(gen) && /shortPriceBlock: block \+ \(pricedEarlyMarkets\.length \?/.test(gen) && /pricedEarlyMarkets\.join\("\\n"\)/.test(gen) && /input\.intent === EARLY_FREE_GENERATION_INTENT && odds/.test(gen));
check("only unpayable Double Chance drafted: one more ask for the next best pick, not a failure", /first\.every\(\(p\) => unpayable\(p\) \|\| offMarket\(p\)\)/.test(gen) && /shortPriceRetryBlock\(priceOdds, dc, input\.home, input\.away\)/.test(gen) && /await callModel\(retryBlock\)/.test(gen));
check("generate.ts drops low-odds selections and unpriced team totals", /isUnpayableDoubleChance\(priceOdds, p\.marketType, p\.selection\)/.test(gen) && /automaticOddsFailure\(priceOdds, p\.marketType, p\.selection\)/.test(gen) && /modelDrafts\.filter\(\(p\) => !unpayable\(p\)\)/.test(gen));
check("generate.ts covers ordinary and Goals and skips manual/handicap/paid paths", /guardsShortPrice = !input\.manual && !input\.handicapLine && input\.intent !== "VIP_PREMIUM"/.test(gen) && /const checksMarket = !input\.handicapLine && input\.intent !== "VIP_PREMIUM"/.test(gen) && /const priceOdds = guardsShortPrice \? odds : null;/.test(gen));
for (const route of ["src/app/api/admin/ai/route.ts", "src/app/api/admin/ai/bulk/route.ts"]) {
  check(`${route.split("/").slice(-2).join("/")}: admin generation is exempt (manual: true)`, /manual: true,/.test(readFileSync(join(__dirname, "..", route), "utf8")));
}
const analysis = readFileSync(join(__dirname, "../src/lib/ai/analysis.ts"), "utf8");
check("analysis.ts puts the block in the prompt", /input\.shortPriceBlock/.test(analysis));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll short-price guard checks passed");
