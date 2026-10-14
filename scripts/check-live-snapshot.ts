/**
 * Live scores cannot spend the api-football quota however many people watch
 * (src/lib/liveSnapshot.ts, src/components/LiveScores.tsx). Pure, no database.
 *
 * Run: npx tsx scripts/check-live-snapshot.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LIVE_POLICY, callsToday, parseLiveSnapshot, refreshIntervalSeconds, trimLiveRow, type LiveSnapshot } from "../src/lib/liveSnapshot";
import { DAILY_LIMIT, RESERVE } from "../src/lib/football/usage";
import { anyInPlayWindow, LIVE_WINDOW_MS } from "../src/components/LiveScores";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}

const NOW = new Date("2026-10-14T19:00:00Z");
const snap = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({ version: 1, day: "2026-10-14", calls: 0, fetchedAt: null, rows: [], ...over });

// Freshness: as fast as the plan allows, all day.
check("the fastest refresh is every 15 seconds", LIVE_POLICY.MIN_REFRESH_SECONDS === 15);
check("plenty of quota: refresh every 15 seconds", refreshIntervalSeconds(4_000, NOW) === 15, refreshIntervalSeconds(4_000, NOW));
{
  // 19:00 UTC, 5 hours left; 600 calls above the reserve: spread to one per 30 s, not frozen.
  const i = refreshIntervalSeconds(LIVE_POLICY.GENERATION_RESERVE + 600, NOW);
  check("low quota slows the refresh instead of freezing it", i === 30, i);
}
check("nothing left above the reserve: no refresh", refreshIntervalSeconds(LIVE_POLICY.GENERATION_RESERVE, NOW) === null);
check("quota unknown: no refresh (fails closed)", refreshIntervalSeconds(null, NOW) === null);
check("the reserve kept for generation is a small, real share", LIVE_POLICY.GENERATION_RESERVE >= 300 && LIVE_POLICY.GENERATION_RESERVE <= 1_000);
check("yesterday's count does not carry into today", callsToday(snap({ day: "2026-10-13", calls: 9_999 }), NOW) === 0);
check("a corrupt stored copy reads as empty, not as a licence to call", parseLiveSnapshot("{oops").calls === 0 && parseLiveSnapshot("{oops").rows.length === 0);

// Worst case: a reader every second all day, other jobs spending 3,000 calls.
// Live never takes the reserve, and never stops before midnight while there is budget.
{
  const usable = DAILY_LIMIT - RESERVE;
  let used = 3_000;
  let live = 0;
  let next = 0;
  let lastRefresh = -1;
  for (let t = 0; t < 86_400; t++) {
    if (t < next) continue;
    const at = new Date(Date.parse("2026-10-14T00:00:00Z") + t * 1_000);
    const i = refreshIntervalSeconds(usable - used, at);
    if (i == null) break;
    used++;
    live++;
    lastRefresh = t;
    next = t + i;
  }
  check("a full day of constant readers never spends the generation reserve", usable - used >= LIVE_POLICY.GENERATION_RESERVE - 1, usable - used);
  check("live scores keep refreshing into the last hour of the day", lastRefresh >= 86_400 - 3_600, lastRefresh);
  console.log(`      (simulated: ${live} live calls, ${usable - used} left at midnight)`);
}

// The stored row carries only what the views read.
{
  const full: any = {
    fixture: { id: 1, date: "2026-10-14T18:00:00Z", status: { short: "2H", elapsed: 63 }, venue: { name: "X", city: "Y" }, referee: "Z" },
    league: { id: 39, name: "Premier League", country: "England", logo: "l", season: 2026, round: "R8" },
    teams: { home: { id: 10, name: "A", logo: "a" }, away: { id: 11, name: "B", logo: "b" } },
    goals: { home: 1, away: 0 },
    score: { halftime: { home: 1, away: 0 } },
  };
  const t: any = trimLiveRow(full);
  check("trimmed row keeps teams, goals and status", t.teams.home.id === 10 && t.goals.home === 1 && t.fixture.status.elapsed === 63);
  check("trimmed row drops venue, referee and score breakdown", !t.fixture.venue && !t.fixture.referee && !t.score);
}

// The browser polls only while a match on the page can be in play.
{
  const k = Date.parse("2026-10-14T18:00:00Z");
  check("no poll before kickoff", !anyInPlayWindow([{ home: 1, away: 2, kickoff: k }], k - 60_000));
  check("polls during the match", anyInPlayWindow([{ home: 1, away: 2, kickoff: k }], k + 45 * 60_000));
  check("no poll after the live window", !anyInPlayWindow([{ home: 1, away: 2, kickoff: k }], k + LIVE_WINDOW_MS + 60_000));
  check("a page of settled tips never polls", !anyInPlayWindow([{ home: 1, away: 2, kickoff: k - 86_400_000 }], k));
}

// Every reader goes through the snapshot.
{
  const route = readFileSync(join(__dirname, "..", "src", "app", "api", "livescores", "route.ts"), "utf8");
  check("/api/livescores reads the shared snapshot, never the provider directly", route.includes("getLiveSnapshot()") && !route.includes("getLiveFixtures"));
  const lib = readFileSync(join(__dirname, "..", "src", "lib", "liveSnapshot.ts"), "utf8");
  check("the provider call sits behind the quota-paced lease", lib.indexOf("refreshIntervalSeconds(usage") < lib.indexOf("claimRefresh(now, interval)") && lib.indexOf("claimRefresh(now, interval)") < lib.indexOf("await getLiveFixtures()"));
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll live-snapshot checks passed");
