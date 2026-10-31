/**
 * Market sanity (src/lib/marketSanity.ts), domestic context for cup fixtures
 * (pickDomesticStanding in src/lib/ai/generationContext.ts) and the backup-AI
 * flag (src/lib/ai/backupModel.ts). The case behind all three: Shakhtar to win
 * at Inter at 55%, written by the fallback model from two Champions League
 * games, with the market at about 8%. Pure, no database.
 *
 * Run: npx tsx scripts/check-market-sanity.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MARKET_SANITY_MAX_GAP_PP, marketProbabilityFor, farAboveMarket, marketSanityRetryBlock } from "../src/lib/marketSanity";
import { devigProbability } from "../src/lib/marketConfirmed";
import { pickDomesticStanding } from "../src/lib/ai/generationContext";
import { isBackupModel } from "../src/lib/ai/backupModel";
import { bulkFailureReason } from "../src/lib/generation/bulkRun";
import type { FixtureOdds } from "../src/lib/odds";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}

const sel = (value: string, median: number) => ({ value, best: median + 0.02, median, bookmakers: 8, bestBookmaker: "x" });
// Inter v Shakhtar, 21 Oct 2026, median prices.
const interShakhtar = {
  bookmakerCount: 8,
  update: null,
  markets: [
    { market: "Match Winner", selections: [sel("Home", 1.21), sel("Draw", 7.5), sel("Away", 12.4)] },
    { market: "Double Chance", selections: [sel("Home/Draw", 1.03), sel("Home/Away", 1.13), sel("Draw/Away", 4.3)] },
    { market: "Both Teams Score", selections: [sel("Yes", 2.1), sel("No", 1.7)] },
    { market: "Goals Over/Under", selections: [sel("Over 2.5", 1.5), sel("Under 2.5", 2.6)] },
  ],
} as unknown as FixtureOdds;

console.log("1. Market probability");
const away = marketProbabilityFor(interShakhtar, "MATCH_WINNER", { value: "AWAY" });
check("Shakhtar to win: about 8%", away != null && away > 6 && away < 10, away);
const home = marketProbabilityFor(interShakhtar, "MATCH_WINNER", { value: "HOME" });
check("Inter to win: about 80%", home != null && home > 75 && home < 85, home);
check("Draw No Bet Inter: above the 1X2 win", (marketProbabilityFor(interShakhtar, "DRAW_NO_BET", { value: "HOME" }) ?? 0) > (home ?? 100));
check("Over 2.5 is priced", marketProbabilityFor(interShakhtar, "OVER_UNDER", { line: 2.5, direction: "OVER" }) != null);
check("BTTS is priced", marketProbabilityFor(interShakhtar, "BTTS", { value: "YES" }) != null);
check("AWAY_OR_DRAW (api-football's \"Draw/Away\") is priced", marketProbabilityFor(interShakhtar, "DOUBLE_CHANCE", { value: "AWAY_OR_DRAW" }) != null);
check("devigProbability reads \"Draw/Away\" as well as \"Away/Draw\"", devigProbability(interShakhtar, "Double Chance", "Draw/Away") != null);
check("Win Either Half has no comparable price: unchecked", marketProbabilityFor(interShakhtar, "WIN_EITHER_HALF", { value: "HOME" }) === null);
check("Correct score: unchecked", marketProbabilityFor(interShakhtar, "CORRECT_SCORE", { home: 2, away: 0 }) === null);
check("no odds: unchecked", marketProbabilityFor(null, "MATCH_WINNER", { value: "AWAY" }) === null);

console.log("\n2. The rule");
const shakhtar = farAboveMarket(interShakhtar, { marketType: "MATCH_WINNER", selection: { value: "AWAY" }, confidence: 55 });
check("Shakhtar to win at 55% is rejected", shakhtar != null && shakhtar.gapPP > 40, shakhtar);
check("Inter to win at 70% (below the market) is kept", farAboveMarket(interShakhtar, { marketType: "MATCH_WINNER", selection: { value: "HOME" }, confidence: 70 }) === null);
check("Inter to win at 92% (12 above) is kept", farAboveMarket(interShakhtar, { marketType: "MATCH_WINNER", selection: { value: "HOME" }, confidence: 92 }) === null);
check(`Over 2.5 within ${MARKET_SANITY_MAX_GAP_PP} points is kept`, farAboveMarket(interShakhtar, { marketType: "OVER_UNDER", selection: { line: 2.5, direction: "OVER" }, confidence: 72 }) === null);
check("Draw at 40% (market about 12%) is rejected", farAboveMarket(interShakhtar, { marketType: "MATCH_WINNER", selection: { value: "DRAW" }, confidence: 40 }) != null);
check("an unpriced market is never rejected", farAboveMarket(interShakhtar, { marketType: "WIN_EITHER_HALF", selection: { value: "AWAY" }, confidence: 80 }) === null);
check("no odds: never rejected", farAboveMarket(null, { marketType: "MATCH_WINNER", selection: { value: "AWAY" }, confidence: 90 }) === null);

console.log("\n3. Second ask");
const retry = marketSanityRetryBlock(interShakhtar, [{ marketType: "MATCH_WINNER", selection: { value: "AWAY" }, confidence: 55 }], "Inter", "Shakhtar Donetsk");
check("names the market's view of the result", /Inter [78]\d%/.test(retry) && /Shakhtar Donetsk [6-9]%/.test(retry), retry);
check("puts the pick beside the market", /Shakhtar Donetsk to win: you said 55%, the market about [6-9]%/.test(retry), retry);
check("points at the domestic standing", /domestic league standing/.test(retry));

console.log("\n4. Domestic standing for cup fixtures");
const row = (teamId: number, rank: number, played: number, points: number) => ({
  rank, teamId, teamName: String(teamId), teamLogo: null, points, played, win: 0, draw: 0, loss: 0, goalsFor: 0, goalsAgainst: 0, form: "WWWDW",
});
const asOf = new Date("2026-10-20T08:00:00Z");
const tables = [
  { leagueApiId: 2, standingsJson: [row(505, 29, 2, 0)], fetchedAt: asOf }, // Champions League
  { leagueApiId: 135, standingsJson: [row(489, 1, 8, 20), row(505, 2, 8, 19), ...Array.from({ length: 18 }, (_, i) => row(900 + i, 3 + i, 8, 10))], fetchedAt: asOf },
];
const inter = pickDomesticStanding(505, tables);
check("Inter: 2nd of 20 in Serie A, not 29th in the Champions League", inter?.league === "Serie A" && inter.country === "Italy" && inter.rank === 2 && inter.of === 20 && inter.played === 8, inter);
check("dated, so its age is visible", inter?.asOf === "2026-10-20");
check("a team in no domestic table: null", pickDomesticStanding(777, tables) === null);
check("cup tables alone: null", pickDomesticStanding(505, [tables[0]]) === null);

console.log("\n5. Backup AI flag");
check("groq pick flagged", isBackupModel("groq:openai/gpt-oss-120b"));
check("gemini pick not flagged", !isBackupModel("gemini:gemini-3.7-flash"));
check("claude pick not flagged", !isBackupModel("anthropic:claude-haiku-5-5"));
check("no job / old unprefixed model: not flagged", !isBackupModel(null) && !isBackupModel("gpt-4o"));

console.log("\n6. Wiring");
const gen = readFileSync(join(__dirname, "../src/lib/ai/generate.ts"), "utf8");
check("odds checks skip Goals, handicap and VIP/PREMIUM but not manual runs", /const checksMarket = !goalsOnly && !input\.handicapLine && input\.intent !== "VIP_PREMIUM";/.test(gen) && /const odds = checksMarket \? await loadFixtureOdds\(/.test(gen));
check("every draft off the market: one more ask with the market's view", /marketSanityRetryBlock\(odds, off, input\.home, input\.away\)/.test(gen));
check("off-market drafts are dropped; none left throws MarketSanityError", /payable\.filter\(\(p\) => !offMarket\(p\)\)/.test(gen) && /throw (await rejected\()?new MarketSanityError\(/.test(gen));
check("bulk panel explains MarketSanityError", /bookmakers/.test(bulkFailureReason(Object.assign(new Error("x"), { name: "MarketSanityError" }))));
const ctx = readFileSync(join(__dirname, "../src/lib/ai/generationContext.ts"), "utf8");
check("cup fixtures carry each side's domestic standing", /if \(cupFixture\) \{\s*\[home\.domestic, away\.domestic\] = await Promise\.all/.test(ctx));
const analysis = readFileSync(join(__dirname, "../src/lib/ai/analysis.ts"), "utf8");
check("cup rule weighs the domestic standing above a short competition sample", /"domestic"/.test(analysis) && /weigh it above this competition's figures/.test(analysis));
const list = readFileSync(join(__dirname, "../src/app/admin/predictions/page.tsx"), "utf8");
const listApi = readFileSync(join(__dirname, "../src/app/api/admin/predictions/route.ts"), "utf8");
check("admin list loads the model and flags backup picks", /aiJob: \{ select: \{ model: true \} \}/.test(listApi) && /isBackupModel\(r\.aiJob\?\.model\)/.test(list));
const detail = readFileSync(join(__dirname, "../src/app/admin/predictions/[id]/page.tsx"), "utf8");
const detailApi = readFileSync(join(__dirname, "../src/app/api/admin/predictions/[id]/route.ts"), "utf8");
check("admin detail loads the model and flags backup picks", /aiJob: \{ select: \{ model: true \} \}/.test(detailApi) && /isBackupModel\(p\.aiJob\?\.model\)/.test(detail));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll market sanity checks passed");
