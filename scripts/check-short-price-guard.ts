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

// The second ask names the worthless prices and the alternatives.
const retryBlock = shortPriceRetryBlock(o, [{ selection: { value: "HOME_OR_DRAW" } }], "Real Madrid", "RB Leipzig");
check("retry ask names the Double Chance price", /Real Madrid or Draw: 1\.04/.test(retryBlock), retryBlock);
check("retry ask forbids Double Chance and lists Draw No Bet, Win Either Half, Match Winner", /Do NOT return DOUBLE_CHANCE/.test(retryBlock) && /DRAW_NO_BET/.test(retryBlock) && /WIN_EITHER_HALF/.test(retryBlock) && /MATCH_WINNER/.test(retryBlock));
check("first-ask block also offers Draw No Bet and Win Either Half", /DRAW_NO_BET/.test(block) && /WIN_EITHER_HALF/.test(block));

// Bulk panel wording.
check("bulk panel explains ShortPriceError", /Double Chance/.test(bulkFailureReason(Object.assign(new Error("x"), { name: "ShortPriceError" }))));

// Wiring.
const gen = readFileSync(join(__dirname, "../src/lib/ai/generate.ts"), "utf8");
check("generate.ts passes shortPriceBlock to the model", /callModel\(shortPriceBlock\(shortPriceSides\(odds, input\.home, input\.away\)\)\)/.test(gen) && /shortPriceBlock: block,/.test(gen));
check("only unpayable Double Chance drafted: one more ask for the next best pick, not a failure", /if \(odds && !goalsOnly && onlyUnpayableDc\(output\.predictions\)\)/.test(gen) && /callModel\(shortPriceRetryBlock\(/.test(gen));
check("generate.ts drops unpayable Double Chance drafts", /isUnpayableDoubleChance\(odds, p\.marketType, p\.selection\)/.test(gen));
check("generate.ts skips the rule for manual runs, Goals, handicap and VIP/PREMIUM", /guardsShortPrice = !input\.manual && !goalsOnly && !input\.handicapLine && input\.intent !== "VIP_PREMIUM"/.test(gen));
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
