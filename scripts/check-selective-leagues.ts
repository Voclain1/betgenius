/**
 * Strong-team filtering for selected SECONDARY and lower-tier domestic leagues.
 * Only qualifying fixtures reach ordinary or early generation. Pure.
 *
 * Run: npx tsx scripts/check-selective-leagues.ts
 */
export {};
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FULL_FIXTURE_DOMESTIC_LEAGUE_IDS, SELECTIVE_LEAGUES, selectiveLeagueRule, isSelectiveLeague, isWorthATip, strongTeamIds } from "../src/lib/generation/selectiveLeagues";
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
const regional: Array<[number, number]> = [
  [307, 4], // Saudi
  [301, 3], // UAE
  [330, 3], // Kuwait
  [288, 4], // South Africa
  [286, 4], // Serbia
  [333, 4], // Ukraine
  [235, 4], // Russia
];
for (const [id, topN] of regional) {
  const standings = new Map([[id, table(8)]]);
  check(`region ${id}: selectively generate only current top ${topN} clubs`,
    generationTierOf(id) === "SECONDARY" && selectiveLeagueRule(id)?.topN === topN &&
    isWorthATip(fx(id, 100 + topN, 108), standings) &&
    isWorthATip(fx(id, 108, 101), standings) &&
    !isWorthATip(fx(id, 105 + (topN === 3 ? 0 : 0), 108), standings) &&
    !isWorthATip(fx(id, 101, 108), new Map([[id, null]])));
  check(`region ${id}: no unearned opening-week ranking`,
    strongTeamIds(id, table(4)).size === 0);
}
// User clarified the EPL/La Liga examples mean ALL major leagues: do not
// silently apply a top-club filter to top domestic competitions elsewhere.
const majorMustStayBroad = [
  39, 140, 135, 78, 61, 88, 94, 144, 203,
  207, 218, 179, 119, 103, 113, 106, 197, 345,
  71, 399, 128, 239, 262, 253, 98, 292, 233,
];
check("every major league explicitly protected from standings-only filtering",
  majorMustStayBroad.every(id => FULL_FIXTURE_DOMESTIC_LEAGUE_IDS.includes(id) && !isSelectiveLeague(id)));
for (const id of majorMustStayBroad) {
  check(`major ${id} all fixtures remain eligible even between weak clubs`,
    isWorthATip(fx(id, 107, 108), new Map()) &&
    isWorthATip(fx(id, 107, 108), new Map([[id, null]])));
}
check("fallback Argentina, Mexico, MLS and Japan remain full-fixture",
  [128, 262, 253, 98].every(id => generationTierOf(id) === "FALLBACK" && !isSelectiveLeague(id)));
check("fallback domestic second-tier league is selective", isSelectiveLeague(79) && selectiveLeagueRule(79)?.topN === 4);
check("deep fallback domestic league is selective", isSelectiveLeague(110));
check("famous European core league still evaluates all fixtures", !isSelectiveLeague(39) && !isSelectiveLeague(140));
check("all major mid-European leagues retain full fixture coverage",
  [88, 94, 144, 203].every(id => !isSelectiveLeague(id)));
check("fallback international cups and national sides retain their existing gates", !isSelectiveLeague(13) && !isSelectiveLeague(10));
check("senior women's fallback leagues retain their separate quality gates", !isSelectiveLeague(64) && !isSelectiveLeague(549));

check("their full results stay off the homepage Recent results", !RESULTS_LEAGUE_IDS.has(318) && !RESULTS_LEAGUE_IDS.has(365));

const selector = readFileSync(join(__dirname, "../src/lib/generation/selector.ts"), "utf8");
check("candidate selection applies the rule (both discovery paths go through it)", selector.includes(".filter((f) => isWorthATip(f, tables))"));
const queue = readFileSync(join(__dirname, "../src/lib/generation/queue.ts"), "utf8");
check("previously queued ordinary and early fixtures cannot bypass selective rule",
  queue.includes("filterSelectiveQueuedCandidates(candidates, now)"));
const selectiveSrc = readFileSync(join(__dirname, "../src/lib/generation/selectiveLeagues.ts"), "utf8");
check("standings snapshots older than 48h cannot qualify a fixture",
  selectiveSrc.includes("48 * 3_600_000") && selectiveSrc.includes("usable ?"));


if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll selective league checks passed");
