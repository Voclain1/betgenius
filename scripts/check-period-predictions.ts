/**
 * Weekend and midweek pages (src/lib/periodPredictions.ts), checked without a
 * database: which days each page shows on every weekday, and the period Banker.
 *
 * Run: npx tsx scripts/check-period-predictions.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

import { periodWindow, picksArriveFrom, selectPeriodBankers, lagosWeekday, type PeriodBankerRow } from "../src/lib/periodPredictions";
import { BANKER_MAX_PICKS, VIP_GENERATED_PROVENANCE } from "../src/lib/geniusCuration";
import { lagosDateKey } from "../src/lib/lagosDate";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}

// 2026-10-12 is a Monday. Noon Lagos each day of that week.
const at = (date: string) => new Date(`${date}T12:00:00+01:00`);
const keys = (w: ReturnType<typeof periodWindow>) => w.days.map((d) => d.key);

check("2026-10-12 is a Lagos Monday", lagosWeekday(at("2026-10-12")) === 1);

const WEEKEND: Record<string, { state: string; days: string[] }> = {
  "2026-10-12": { state: "finished", days: ["2026-10-09", "2026-10-10", "2026-10-11"] }, // Mon
  "2026-10-13": { state: "finished", days: ["2026-10-09", "2026-10-10", "2026-10-11"] }, // Tue
  "2026-10-14": { state: "upcoming", days: ["2026-10-16", "2026-10-17", "2026-10-18"] }, // Wed
  "2026-10-15": { state: "upcoming", days: ["2026-10-16", "2026-10-17", "2026-10-18"] }, // Thu
  "2026-10-16": { state: "live", days: ["2026-10-16", "2026-10-17", "2026-10-18"] }, // Fri
  "2026-10-17": { state: "live", days: ["2026-10-16", "2026-10-17", "2026-10-18"] }, // Sat
  "2026-10-18": { state: "live", days: ["2026-10-16", "2026-10-17", "2026-10-18"] }, // Sun
};
for (const [date, want] of Object.entries(WEEKEND)) {
  const w = periodWindow("weekend", at(date));
  check(`weekend on ${date}: ${want.state} ${want.days[0]}..${want.days[2]}`, w.state === want.state && JSON.stringify(keys(w)) === JSON.stringify(want.days), { state: w.state, days: keys(w) });
}

const MIDWEEK: Record<string, { state: string; days: string[] }> = {
  "2026-10-12": { state: "upcoming", days: ["2026-10-13", "2026-10-14", "2026-10-15"] }, // Mon
  "2026-10-13": { state: "live", days: ["2026-10-13", "2026-10-14", "2026-10-15"] }, // Tue
  "2026-10-15": { state: "live", days: ["2026-10-13", "2026-10-14", "2026-10-15"] }, // Thu
  "2026-10-16": { state: "finished", days: ["2026-10-13", "2026-10-14", "2026-10-15"] }, // Fri
  "2026-10-17": { state: "finished", days: ["2026-10-13", "2026-10-14", "2026-10-15"] }, // Sat
  "2026-10-18": { state: "upcoming", days: ["2026-10-20", "2026-10-21", "2026-10-22"] }, // Sun
};
for (const [date, want] of Object.entries(MIDWEEK)) {
  const w = periodWindow("midweek", at(date));
  check(`midweek on ${date}: ${want.state} ${want.days[0]}..${want.days[2]}`, w.state === want.state && JSON.stringify(keys(w)) === JSON.stringify(want.days), { state: w.state, days: keys(w) });
}

{
  const w = periodWindow("weekend", at("2026-10-16"));
  check("the window runs Friday 00:00 to Monday 00:00 Lagos", w.start.toISOString() === "2026-10-15T23:00:00.000Z" && w.end.toISOString() === "2026-10-18T23:00:00.000Z");
  check("Sunday's picks arrive from Friday", lagosDateKey(picksArriveFrom(w.days[2])) === "2026-10-16");
}

// Period Banker.
let n = 0;
const row = (id: string, over: Partial<PeriodBankerRow> = {}): PeriodBankerRow => {
  n += 2;
  return { id, leagueApiId: 39, confidence: 80, provenance: null, marketType: "MATCH_WINNER", kickoff: at("2026-10-17"), fixtureApiId: n, homeTeamApiId: n, awayTeamApiId: n + 1, ...over };
};
{
  const rows = [
    row("sun90", { confidence: 90, kickoff: at("2026-10-18") }),
    row("fri88", { confidence: 88, kickoff: at("2026-10-16") }),
    row("weak", { confidence: 74 }),
    row("double", { confidence: 95, marketType: "SAME_GAME_DOUBLE" }),
    row("paid", { confidence: 95, provenance: VIP_GENERATED_PROVENANCE }),
    ...Array.from({ length: BANKER_MAX_PICKS + 2 }, (_, i) => row(`f${i}`, { confidence: 80 })),
  ];
  const picked = selectPeriodBankers(rows).map((r) => r.id);
  check("period banker spans the days, strongest first", picked[0] === "sun90" && picked[1] === "fri88");
  check(`period banker is capped at ${BANKER_MAX_PICKS}`, picked.length === BANKER_MAX_PICKS);
  check("period banker skips sub-floor, doubles and paid-only picks", !picked.includes("weak") && !picked.includes("double") && !picked.includes("paid"));
}
{
  const a = row("a", { confidence: 90 });
  const b = { ...row("b", { confidence: 85 }), fixtureApiId: a.fixtureApiId, homeTeamApiId: a.homeTeamApiId, awayTeamApiId: a.awayTeamApiId, kickoff: a.kickoff };
  check("period banker takes one pick per match", JSON.stringify(selectPeriodBankers([a, b]).map((r) => r.id)) === JSON.stringify(["a"]));
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll weekend/midweek checks passed");
