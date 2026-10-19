/**
 * Market pages list each match's pick once, and never drop a match
 * (onePerMatchAndPick in src/lib/marketHubs.ts). Pure.
 *
 * Run: npx tsx scripts/check-market-hub-dedupe.ts
 */
export {};
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { onePerMatchAndPick } from "../src/lib/marketHubs";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}
const over25 = { line: 2.5, direction: "OVER" };
const row = (id: string, fixtureApiId: number, cats: string[], confidence: number, selection: unknown = over25, marketType = "OVER_UNDER") =>
  ({ id, fixtureApiId, marketType, selection, confidence, categories: cats.map((category) => ({ category })) });

// The Al-Hilal v Al-Hazm case: combo leg + the Goals pass's own pick.
const leg = row("leg", 1603058, ["SAME_GAME_DOUBLE"], 76);
const own = row("own", 1603058, ["GOALS", "GENIUS", "BANKER"], 80);
check("same match, same pick on two rows: listed once", onePerMatchAndPick([leg, own]).length === 1);
check("...keeping the standalone tip, not the combo leg", onePerMatchAndPick([leg, own])[0].id === "own");
check("...even when the combo leg has the higher confidence", onePerMatchAndPick([row("leg2", 7, ["SAME_GAME_DOUBLE"], 90), row("own2", 7, ["GOALS"], 70)])[0].id === "own2");

// Never drop a match.
const onlyLeg = row("only-leg", 42, ["SAME_GAME_DOUBLE"], 74);
check("a match whose only pick in the market is a combo leg still shows", onePerMatchAndPick([onlyLeg]).map((r) => r.id).join() === "only-leg");
const a = row("a", 1, ["FEATURED"], 70), b = row("b", 2, ["GENIUS"], 75), c = row("c", 3, ["SAME_GAME_DOUBLE"], 72);
check("different matches all stay, in their order", onePerMatchAndPick([a, b, c]).map((r) => r.id).join() === "a,b,c");
const yes = row("yes", 9, ["FEATURED"], 70, { value: "YES" }, "BTTS"), no = row("no", 9, ["GENIUS"], 70, { value: "NO" }, "BTTS");
check("different picks on the same match both stay (only exact repeats collapse)", onePerMatchAndPick([yes, no]).length === 2);
check("key order inside a selection does not matter", onePerMatchAndPick([row("x", 5, ["FEATURED"], 70, { line: 2.5, direction: "OVER" }), row("y", 5, ["GENIUS"], 71, { direction: "OVER", line: 2.5 })]).length === 1);
const noId = { id: "n1", homeTeamApiId: 10, awayTeamApiId: 11, kickoff: "2026-10-19T18:00:00Z", marketType: "OVER_UNDER", selection: over25, confidence: 70, categories: [] };
check("rows without a fixture id match on teams and day", onePerMatchAndPick([noId, { ...noId, id: "n2", confidence: 72 }]).map((r) => r.id).join() === "n2");

// Wiring: every market page applies it, and none filters combo legs out.
const src = readFileSync(join(__dirname, "../src/lib/marketPredictions.ts"), "utf8");
check("all four market pages collapse repeats", (src.match(/orderForDisplay\(onePerMatchAndPick\(rows\)\)/g) ?? []).length === 4);
check("no market page excludes combo legs outright", !/SAME_GAME_DOUBLE/.test(src));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll market page duplicate checks passed");
