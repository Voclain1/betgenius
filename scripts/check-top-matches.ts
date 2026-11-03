/**
 * Asserts the homepage Top matches selector (src/lib/topMatches.ts): published
 * matches only (every card opens a prediction page), covered men's
 * competitions only, big clubs first, at most two per competition while others
 * exist, the same picks before kickoff and after full time, today before
 * tomorrow, and nothing when neither day has a top match.
 *
 * Pure: no database, no network. Run: npx tsx scripts/check-top-matches.ts
 */
export {};
import {
  selectTopMatches,
  selectTopMatchesForDay,
  orderTopMatchCards,
  overlayLive,
  TOP_MATCHES_POLICY,
} from "../src/lib/topMatches";
import { matchKey } from "../src/lib/slug";
import type { FixtureRow } from "../src/lib/football/api-football";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`);
}
const ids = (rows: FixtureRow[]) => rows.map((r) => r.fixture.id);
/** A link index in which every given row has a published prediction. */
const idx = (rows: FixtureRow[]) =>
  Object.fromEntries(rows.map((r) => [matchKey({ homeTeamApiId: r.teams.home.id, awayTeamApiId: r.teams.away.id, kickoff: r.fixture.date })!, `m${r.fixture.id}`]));
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// 2026-11-02 12:00 WAT.
const NOW = new Date("2026-11-02T11:00:00Z");
let next = 1;
function fx(o: { league: number; home: number; away: number; at: string; status?: string; goals?: [number, number] }): FixtureRow {
  return {
    fixture: { id: next++, date: o.at, status: { short: o.status ?? "NS", elapsed: null } },
    league: { id: o.league, name: `L${o.league}`, country: "X", season: 2026 },
    teams: { home: { id: o.home, name: `T${o.home}` }, away: { id: o.away, name: `T${o.away}` } },
    goals: { home: o.goals?.[0] ?? null, away: o.goals?.[1] ?? null },
  };
}

console.log("Scope");
{
  const minor = fx({ league: 79, home: 1001, away: 1002, at: "2026-11-02T18:00:00Z" });
  const women = fx({ league: 44, home: 1003, away: 1004, at: "2026-11-02T18:00:00Z" });
  const postponed = fx({ league: 39, home: 1005, away: 1006, at: "2026-11-02T18:00:00Z", status: "PST" });
  const epl = fx({ league: 39, home: 1007, away: 1008, at: "2026-11-02T18:00:00Z" });
  const all = [minor, women, postponed, epl];
  const r = selectTopMatches(all, NOW, idx(all));
  check("only covered men's competitions, not postponed", same(ids(r.rows), [epl.fixture.id]), String(ids(r.rows)));
  const unpublished = fx({ league: 39, home: 33, away: 40, at: "2026-11-02T18:00:00Z" });
  const r2 = selectTopMatches([epl, unpublished], NOW, idx([epl]));
  check("only matches with a published prediction", same(ids(r2.rows), [epl.fixture.id]), String(ids(r2.rows)));
  check("no index: nothing", selectTopMatches([epl], NOW).rows.length === 0);
}

console.log("Ranking");
{
  const plain = fx({ league: 2, home: 2001, away: 2002, at: "2026-11-02T17:45:00Z" });
  const oneBig = fx({ league: 39, home: 33, away: 2003, at: "2026-11-02T20:00:00Z" });
  const twoBig = fx({ league: 140, home: 541, away: 529, at: "2026-11-02T20:00:00Z" });
  const r = selectTopMatchesForDay([plain, oneBig, twoBig], NOW, 0, idx([plain, oneBig, twoBig]));
  check("two big clubs, then one, then competition rank", same(ids(r), [twoBig.fixture.id, oneBig.fixture.id, plain.fixture.id]), String(ids(r)));
}
{
  const epl = [1, 2, 3, 4].map((i) => fx({ league: 39, home: 3000 + i, away: 3100 + i, at: "2026-11-02T15:00:00Z" }));
  const liga = fx({ league: 140, home: 3201, away: 3202, at: "2026-11-02T20:00:00Z" });
  const r = selectTopMatchesForDay([...epl, liga], NOW, 0, idx([...epl, liga]));
  const eplCount = r.filter((x) => x.league.id === 39).length;
  check("at most two per competition while others exist", eplCount === 3 && r.includes(liga) && r.length === 4, `epl=${eplCount}`);
  // Only one competition: still fills the strip.
  const onlyEpl = selectTopMatchesForDay(epl, NOW, 0, idx(epl));
  check("a one-competition day still fills the strip", onlyEpl.length === TOP_MATCHES_POLICY.LIMIT);
}
console.log("Stable through the day");
{
  const pre = [
    fx({ league: 39, home: 33, away: 49, at: "2026-11-02T16:00:00Z" }),
    fx({ league: 61, home: 85, away: 5001, at: "2026-11-02T20:00:00Z" }),
    fx({ league: 39, home: 40, away: 42, at: "2026-11-02T13:30:00Z" }),
    fx({ league: 135, home: 5002, away: 5003, at: "2026-11-02T19:45:00Z" }),
    fx({ league: 78, home: 5004, away: 5005, at: "2026-11-02T14:30:00Z" }),
  ];
  const settled = pre.map((r, i) => ({ ...r, fixture: { ...r.fixture, status: { short: i % 2 ? "2H" : "FT", elapsed: 70 } }, goals: { home: 1, away: 0 } }));
  const before = ids(selectTopMatchesForDay(pre, NOW, 0, idx(pre))).sort();
  const after = ids(selectTopMatchesForDay(settled, new Date("2026-11-02T22:00:00Z"), 0, idx(settled))).sort();
  check("same matches before kickoff and at full time", same(before, after), `${before} vs ${after}`);

  const ordered = orderTopMatchCards(settled.slice(0, 4));
  check("cards: in play first, results last", ordered[0].fixture.status.short === "2H" && ordered[3].fixture.status.short === "FT");
}

console.log("Which day");
{
  const tomorrow = fx({ league: 39, home: 6001, away: 6002, at: "2026-11-03T15:00:00Z" });
  const r = selectTopMatches([tomorrow], NOW, idx([tomorrow]));
  check("no top match today: tomorrow's", r.day === "tomorrow" && same(ids(r.rows), [tomorrow.fixture.id]));
  const today = fx({ league: 39, home: 6003, away: 6004, at: "2026-11-02T09:00:00Z", status: "FT", goals: [0, 1] });
  const r2 = selectTopMatches([tomorrow, today], NOW, idx([tomorrow, today]));
  const r2b = selectTopMatches([tomorrow, today], NOW, idx([tomorrow]));
  check("today's matches unpublished: tomorrow's", r2b.day === "tomorrow" && same(ids(r2b.rows), [tomorrow.fixture.id]));
  check("a finished top match keeps today's strip", r2.day === "today" && same(ids(r2.rows), [today.fixture.id]));
  // 23:30 UTC on the 2nd is 00:30 WAT on the 3rd: tomorrow in Lagos.
  const lateUtc = fx({ league: 39, home: 6005, away: 6006, at: "2026-11-02T23:30:00Z" });
  const r3 = selectTopMatches([lateUtc], NOW, idx([lateUtc]));
  check("days are Lagos days", r3.day === "tomorrow" && r3.rows.length === 1);
  const far = fx({ league: 39, home: 1, away: 2, at: "2026-11-05T15:00:00Z" });
  const none = selectTopMatches([far], NOW, idx([far]));
  check("neither day: nothing (section hidden)", none.rows.length === 0);
}

console.log("Live overlay");
{
  const r = fx({ league: 39, home: 7001, away: 7002, at: "2026-11-02T10:00:00Z" });
  const live = { ...r, fixture: { ...r.fixture, status: { short: "2H", elapsed: 72 } }, goals: { home: 2, away: 0 } };
  const [o] = overlayLive([r], [live]);
  check("live minute and score laid over the stored row", o.fixture.status.short === "2H" && o.fixture.status.elapsed === 72 && o.goals.home === 2);
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll top-matches checks passed");
