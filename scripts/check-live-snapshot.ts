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
import { LIVE_POLICY, callsToday, mayRefresh, parseLiveSnapshot, trimLiveRow, type LiveSnapshot } from "../src/lib/liveSnapshot";
import { DAILY_LIMIT } from "../src/lib/football/usage";
import { anyInPlayWindow, LIVE_WINDOW_MS } from "../src/components/LiveScores";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}

const NOW = new Date("2026-10-14T19:00:00Z");
const snap = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({ version: 1, day: "2026-10-14", calls: 0, fetchedAt: null, rows: [], ...over });

// The ceiling, independent of readers.
check("refresh is at most once per 30 seconds site-wide", LIVE_POLICY.REFRESH_SECONDS >= 30);
check("the daily cap is a small share of the plan", LIVE_POLICY.DAILY_CALL_CAP <= DAILY_LIMIT * 0.2, LIVE_POLICY.DAILY_CALL_CAP);
check("refused at the daily cap", !mayRefresh(snap({ calls: LIVE_POLICY.DAILY_CALL_CAP }), NOW, 5_000).ok);
check("allowed below the cap with headroom", mayRefresh(snap({ calls: LIVE_POLICY.DAILY_CALL_CAP - 1 }), NOW, 5_000).ok);
check("refused when quota headroom is low", !mayRefresh(snap(), NOW, LIVE_POLICY.MIN_QUOTA_REMAINING - 1).ok);
check("refused when the quota cannot be read (fails closed)", !mayRefresh(snap(), NOW, null).ok);
check("yesterday's count does not block today", callsToday(snap({ day: "2026-10-13", calls: 9_999 }), NOW) === 0);
check("a corrupt stored copy reads as empty, not as a licence to call", parseLiveSnapshot("{oops").calls === 0 && parseLiveSnapshot("{oops").rows.length === 0);

// Worst case: a reader every second all day. Calls = lease windows that pass mayRefresh.
{
  let s = snap({ day: "" });
  let calls = 0;
  for (let t = 0; t < 86_400; t += LIVE_POLICY.REFRESH_SECONDS) {
    const at = new Date(Date.parse("2026-10-14T00:00:00Z") + t * 1_000);
    if (mayRefresh(s, at, 5_000).ok) {
      calls++;
      s = { ...s, day: "2026-10-14", calls: callsToday(s, at) + 1 };
    }
  }
  check(`a full day of constant readers spends at most ${LIVE_POLICY.DAILY_CALL_CAP} calls`, calls === LIVE_POLICY.DAILY_CALL_CAP, calls);
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
  check("the provider call sits behind the lease and the cap", lib.indexOf("claimRefresh(now)") < lib.indexOf("getLiveFixtures()") && lib.indexOf("mayRefresh(previous") < lib.indexOf("await getLiveFixtures()"));
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll live-snapshot checks passed");
