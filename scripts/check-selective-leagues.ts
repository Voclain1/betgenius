/**
 * Cyprus and Latvia are generated daily, but only for matches with a top-three
 * club (src/lib/generation/selectiveLeagues.ts). Pure.
 *
 * Run: npx tsx scripts/check-selective-leagues.ts
 */
export {};
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SELECTIVE_LEAGUES, isWorthATip, strongTeamIds } from "../src/lib/generation/selectiveLeagues";
import { generationTierOf } from "../src/lib/leagues";
import { RESULTS_LEAGUE_IDS } from "../src/lib/recentResultsSnapshot";
import type { FixtureRow } from "../src/lib/football/api-football";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}
const fx = (league: number, home: number, away: number) =>
  ({ fixture: { id: home * 1000 + away, date: "2026-10-25T15:00:00Z", status: { short: "NS" } }, league: { id: league }, teams: { home: { id: home, name: `H${home}` }, away: { id: away, name: `A${away}` } } }) as unknown as FixtureRow;
const table = (played = 8) => [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => ({ rank, teamId: 100 + rank, played, teamName: `T${rank}` })) as any[];

check("Cyprus First Division and Latvia Virsliga are SECONDARY", generationTierOf(318) === "SECONDARY" && generationTierOf(365) === "SECONDARY");
check("both are selective, top three only", SELECTIVE_LEAGUES[318]?.topN === 3 && SELECTIVE_LEAGUES[365]?.topN === 3);

const tables = new Map([[318, table()], [365, table()]]);
check("a top-three club at home qualifies", isWorthATip(fx(318, 101, 107), tables));
check("a top-three club away qualifies", isWorthATip(fx(365, 106, 103), tables));
check("two clubs outside the top three are skipped", !isWorthATip(fx(318, 104, 108), tables));
check("no table: nothing in the league qualifies", !isWorthATip(fx(318, 101, 102), new Map([[318, null]])));
check("opening weeks (under 3 games) do not count", strongTeamIds(318, table(2)).size === 0);
check("other leagues are never filtered", isWorthATip(fx(39, 1, 2), new Map()));
check("their full results stay off the homepage Recent results", !RESULTS_LEAGUE_IDS.has(318) && !RESULTS_LEAGUE_IDS.has(365));

const selector = readFileSync(join(__dirname, "../src/lib/generation/selector.ts"), "utf8");
check("candidate selection applies the rule (both discovery paths go through it)", selector.includes(".filter((f) => isWorthATip(f, tables))"));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll selective league checks passed");
