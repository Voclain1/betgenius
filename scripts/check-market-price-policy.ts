/**
 * Price policy (src/lib/marketPricePolicy.ts, src/lib/reviewQueue.ts): a pick
 * under 1.10 is "too short" and blocks publication of a generated pick; team
 * totals have no verifiable price; the prompt menu lists real quotes only.
 * Pure, no database.
 *
 * Run: npx tsx scripts/check-market-price-policy.ts
 */
export {};
import { betterMarketBlock, pricedOptions, priceVerdict, MIN_USEFUL_ODDS } from "../src/lib/marketPricePolicy";
import { classifyQueueRow, publishPriceProblem, type QueueRow } from "../src/lib/reviewQueue";
import type { FixtureOdds } from "../src/lib/odds";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}
const sel = (value: string, median: number, bookmakers = 8) => ({ value, best: median + 0.02, median, bookmakers, bestBookmaker: "x" });
const odds: FixtureOdds = {
  bookmakerCount: 8, update: null,
  markets: [
    { market: "Match Winner", selections: [sel("Home", 1.3), sel("Draw", 5.5), sel("Away", 9)] },
    { market: "Double Chance", selections: [sel("Home/Draw", 1.04), sel("Draw/Away", 3.4), sel("Home/Away", 1.15)] },
    { market: "Goals Over/Under", selections: [sel("Over 0.5", 1.06), sel("Over 1.5", 1.3), sel("Under 4.5", 1.08, 2)] },
  ],
};
const dc = (value: string) => ({ value });

check("min useful odds is 1.10", MIN_USEFUL_ODDS === 1.1);
check("Double Chance at 1.04 is too short and blocks", (() => { const v = priceVerdict(odds, "DOUBLE_CHANCE", dc("HOME_OR_DRAW")); return v.status === "TOO_SHORT" && v.blocksPublication; })());
check("Match Winner at 1.30 is good", priceVerdict(odds, "MATCH_WINNER", dc("HOME")).status === "GOOD");
check("Over 1.5 at 1.30 is good", priceVerdict(odds, "OVER_UNDER", { line: 1.5, direction: "OVER" }).status === "GOOD");
check("Home/Away at 1.15 is low but allowed", (() => { const v = priceVerdict(odds, "DOUBLE_CHANCE", dc("HOME_OR_AWAY")); return v.status === "LOW" && !v.blocksPublication; })());
check("a team total has no verifiable price and blocks", (() => { const v = priceVerdict(odds, "TEAM_TOTAL", { side: "AWAY", line: 2.5, direction: "UNDER" }); return v.status === "NO_PRICE" && v.blocksPublication; })());
check("no odds on file: no price, does not block", (() => { const v = priceVerdict(null, "MATCH_WINNER", dc("HOME")); return v.status === "NO_PRICE" && !v.blocksPublication; })());

const opts = pricedOptions(odds, "Wolves", "Lincoln");
check("menu excludes selections under 1.10", !opts.some((o) => o.median < 1.1), opts);
check("menu excludes selections quoted by under 3 bookmakers", !opts.some((o) => o.value === "Under 4.5"), opts);
check("menu is highest price first", opts.every((o, i) => i === 0 || opts[i - 1].median >= o.median), opts);
check("menu names the team", opts.some((o) => o.label === "Wolves to win"), opts);
const block = betterMarketBlock(odds, "Wolves", "Lincoln");
check("prompt block lists real quotes and forbids team totals", /Wolves to win — 1\.30/.test(block) && /Do not return a team total/.test(block), block);
check("no usable quote: no prompt block", betterMarketBlock(null, "A", "B") === "");

const row = (over: Partial<QueueRow>): QueueRow => ({ id: "p1", marketType: "DOUBLE_CHANCE", selection: dc("HOME_OR_DRAW"), market: "Double Chance", pick: "Wolves or Draw", confidence: 74,
  homeTeam: "Wolves", awayTeam: "Lincoln", leagueName: "Championship", kickoff: new Date("2026-11-28T16:00:00Z"), contextComplete: true, aiJobId: "job1", createdAt: new Date(), ...over });
const now = new Date("2026-11-26T00:00:00Z");
const bad = classifyQueueRow(row({}), odds, now);
check("generated pick at 1.04 needs attention and names better options", bad.problems.length === 1 && bad.betterOptions.some((o) => o.startsWith("Wolves to win")), bad);
check("fair pick with evidence is ready", classifyQueueRow(row({ marketType: "MATCH_WINNER", selection: dc("HOME"), pick: "Wolves" }), odds, now).problems.length === 0);
check("thin evidence needs attention", classifyQueueRow(row({ marketType: "MATCH_WINNER", selection: dc("HOME"), contextComplete: false }), odds, now).problems.length === 1);
check("a hand-written short pick is the admin's call, not blocked", classifyQueueRow(row({ aiJobId: null }), odds, now).problems.length === 0 && publishPriceProblem(row({ aiJobId: null }), odds) === null);
check("publish guard blocks a generated short pick", publishPriceProblem(row({}), odds) != null);

console.log(failures ? `\n${failures} failed` : "\nPrice policy checks passed");
if (failures) process.exit(1);
