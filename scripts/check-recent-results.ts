/**
 * The homepage's Recent results (src/lib/recentResultsSnapshot.ts): which
 * matches it shows, and that it cannot spend the quota with traffic. Pure.
 *
 * Run: npx tsx scripts/check-recent-results.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RECENT_POLICY, RESULTS_LEAGUE_IDS, mayRefreshRecent, parseRecentSnapshot, selectRecentResults, type RecentSnapshot } from "../src/lib/recentResultsSnapshot";
import { DAILY_LIMIT } from "../src/lib/football/usage";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}

const NOW = new Date("2026-10-14T21:00:00Z");
let id = 0;
const fx = (league: number, hoursAgo: number, status = "FT"): any => ({
  fixture: { id: ++id, date: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(), status: { short: status, elapsed: 90 } },
  league: { id: league, name: `L${league}`, country: "X", season: 2026 },
  teams: { home: { id: id * 10, name: "H" }, away: { id: id * 10 + 1, name: "A" } },
  goals: { home: 1, away: 0 },
});

// Coverage: top and mid-tier men's competitions.
for (const [name, lid] of [["Champions League", 2], ["Europa League", 3], ["Premier League", 39], ["Championship", 40], ["Eredivisie", 88], ["Primeira Liga", 94]] as const) {
  check(`${name} results are shown`, RESULTS_LEAGUE_IDS.has(lid));
}
check("women's leagues are not", !RESULTS_LEAGUE_IDS.has(44));
check("deep-fallback leagues are not (Wales)", !RESULTS_LEAGUE_IDS.has(110));

{
  const rows = [fx(40, 3), fx(2, 26), fx(2, 2), fx(39, 40), fx(110, 1), fx(2, 1, "2H"), fx(2, 1, "PST")];
  const out = selectRecentResults(rows, NOW);
  const leagues = out.map((r) => r.league.id);
  check("yesterday's UCL (26h ago) is inside the 36h window", out.some((r) => r.league.id === 2 && r.fixture.date === rows[1].fixture.date));
  check("older than 36h is dropped", !out.some((r) => r.fixture.date === rows[3].fixture.date));
  check("live and postponed matches are not results", out.every((r) => r.fixture.status.short === "FT"));
  check("out-of-scope leagues are dropped", !leagues.includes(110));
  check("UCL first, most recent first, then the Championship", JSON.stringify(out.map((r) => r.fixture.id)) === JSON.stringify([rows[2].fixture.id, rows[1].fixture.id, rows[0].fixture.id]), out.map((r) => r.fixture.id));
}

// Quota.
const snap = (calls: number): RecentSnapshot => ({ version: 1, day: "2026-10-14", calls, fetchedAt: null, rows: [] });
check("refresh at most every 15 minutes site-wide", RECENT_POLICY.REFRESH_MINUTES >= 15);
check("daily cap is a small share of the plan", RECENT_POLICY.DAILY_CALL_CAP <= DAILY_LIMIT * 0.05, RECENT_POLICY.DAILY_CALL_CAP);
check("refused when the next refresh would pass the cap", !mayRefreshRecent(snap(RECENT_POLICY.DAILY_CALL_CAP - 1), NOW, 5_000));
check("refused when quota headroom is low", !mayRefreshRecent(snap(0), NOW, RECENT_POLICY.MIN_QUOTA_REMAINING - 1));
check("refused when quota is unknown (fails closed)", !mayRefreshRecent(snap(0), NOW, null));
check("allowed with headroom and room under the cap", mayRefreshRecent(snap(0), NOW, 5_000));
check("a corrupt copy reads as empty", parseRecentSnapshot("{bad").rows.length === 0);

// Wiring.
const comp = readFileSync(join(__dirname, "..", "src", "components", "RecentResults.tsx"), "utf8");
const home = readFileSync(join(__dirname, "..", "src", "app", "(public)", "page.tsx"), "utf8");
check("the browser no longer fetches slates for this block", !comp.includes("fetch("));
check("the homepage hides the block when nothing has finished", /recentResults\.length > 0 && \(/.test(home));

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll recent-results checks passed");
