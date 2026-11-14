/**
 * Sprint 02 Match Centre — pure checks (no database, no network).
 *
 * Every statistic the Match Centre prints is asserted here against
 * hand-built fixtures whose answers are worked out by hand in the comments.
 *
 * Run: npx tsx scripts/check-match-centre.ts
 */
export {};

import {
  comparisonRows,
  compactFixtureResult,
  formGrid,
  formSource,
  summarizeForm,
  formSummary,
  formatComparisonValue,
  formatRate,
  h2hWindow,
  matchState,
  mergeFixtureResult,
  minuteLabel,
  pct,
  rate,
  readFixtureResult,
  resultLabel,
  scopeDescription,
  tableContext,
  tableSentence,
} from "../src/lib/matchCentre";
import type { InsightFixture } from "../src/lib/insights";
import type { H2HMeeting } from "../src/lib/h2h";
import type { LeagueStandingRow } from "../src/lib/enrichment";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}
const eq = (label: string, a: unknown, b: unknown) => check(label, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const TEAM = 42; // our team
const KICKOFF = new Date("2026-11-14T15:00:00Z");
let nextId = 1000;
function fx(o: Partial<InsightFixture> & { date: string; homeId: number; awayId: number; home: number | null; away: number | null }): InsightFixture {
  return { id: nextId++, status: "FT", leagueId: 39, leagueName: "Premier League", homeName: `T${o.homeId}`, awayName: `T${o.awayId}`, ...o };
}

console.log("rates:");
{
  eq("rate with sample", rate(7, 10), { n: 7, d: 10 });
  eq("no sample → null, never 0%", rate(0, 0), null);
  eq("pct rounds", pct({ n: 2, d: 3 }), 67);
  eq("format", formatRate({ n: 7, d: 10 }), "7 of 10 · 70%");
  eq("format missing", formatRate(null), "—");
}

// A 12-match history for TEAM, newest first by date (deliberately stored out of order).
// Scores are from TEAM's perspective in the comment: (for-against, venue)
const H: InsightFixture[] = [
  fx({ date: "2026-11-09T15:00:00Z", homeId: TEAM, awayId: 1, home: 2, away: 1 }), // 2-1 H W  total3 btts
  fx({ date: "2026-11-02T15:00:00Z", homeId: 2, awayId: TEAM, home: 0, away: 0 }), // 0-0 A D  total0 cs fts
  fx({ date: "2026-10-26T15:00:00Z", homeId: TEAM, awayId: 3, home: 3, away: 0 }), // 3-0 H W  total3 cs
  fx({ date: "2026-10-19T15:00:00Z", homeId: 4, awayId: TEAM, home: 2, away: 1 }), // 1-2 A L  total3 btts
  fx({ date: "2026-10-12T15:00:00Z", homeId: TEAM, awayId: 5, home: 1, away: 1, leagueId: 48, leagueName: "EFL Cup" }), // 1-1 H D total2 btts (cup)
  fx({ date: "2026-10-05T15:00:00Z", homeId: 6, awayId: TEAM, home: 0, away: 4 }), // 4-0 A W total4 cs
  fx({ date: "2026-09-28T15:00:00Z", homeId: TEAM, awayId: 7, home: 0, away: 1 }), // 0-1 H L total1 fts
  fx({ date: "2026-09-21T15:00:00Z", homeId: 8, awayId: TEAM, home: 1, away: 1 }), // 1-1 A D total2 btts
  fx({ date: "2026-09-14T15:00:00Z", homeId: TEAM, awayId: 9, home: 2, away: 2 }), // 2-2 H D total4 btts
  fx({ date: "2026-09-07T15:00:00Z", homeId: 10, awayId: TEAM, home: 0, away: 1 }), // 1-0 A W total1 cs
  fx({ date: "2026-08-31T15:00:00Z", homeId: TEAM, awayId: 11, home: 5, away: 0 }), // 5-0 H W (11th — outside last 10)
  fx({ date: "2026-08-24T15:00:00Z", homeId: 12, awayId: TEAM, home: 1, away: 0 }), // 0-1 A L (12th)
];
const shuffled = [H[5], H[0], H[11], H[2], H[8], H[1], H[3], H[10], H[4], H[7], H[6], H[9]];

console.log("form summary (all competitions):");
{
  const s10 = formSummary({ history: shuffled, teamApiId: TEAM, teamName: "Us", side: "home", scope: "ALL", window: 10, cutoff: KICKOFF });
  eq("last 10 played", s10.played, 10);
  eq("newest first regardless of storage order", s10.matches.slice(0, 3).map((m) => m.date.slice(0, 10)), ["2026-11-09", "2026-11-02", "2026-10-26"]);
  eq("sample window dates", [s10.from?.slice(0, 10), s10.to?.slice(0, 10)], ["2026-09-07", "2026-11-09"]);
  eq("W-D-L (4 W, 4 D, 2 L)", [s10.wins, s10.draws, s10.losses], [4, 4, 2]);
  eq("goals for/against 15-8", [s10.goalsFor, s10.goalsAgainst], [15, 8]);
  eq("averages 1.5 / 0.8 / 2.3", [s10.avgFor, s10.avgAgainst, s10.avgTotal], [1.5, 0.8, 2.3]);
  eq("clean sheets 4/10", s10.cleanSheets, { n: 4, d: 10 });
  eq("failed to score 2/10", s10.failedToScore, { n: 2, d: 10 });
  eq("BTTS 5/10", s10.btts, { n: 5, d: 10 });
  eq("over 0.5 9/10 (one 0-0)", s10.over05, { n: 9, d: 10 });
  eq("over 1.5 7/10", s10.over15, { n: 7, d: 10 });
  eq("over 2.5 5/10", s10.over25, { n: 5, d: 10 });
  eq("over 3.5 2/10", s10.over35, { n: 2, d: 10 });
  eq("points per game (4*3+4)/10 = 1.6", s10.ppg, 1.6);
  eq("competitions listed (scope made explicit)", s10.competitions, ["Premier League", "EFL Cup"]);
  eq("win rate 4/10", s10.winRate, { n: 4, d: 10 });
  const s5 = formSummary({ history: shuffled, teamApiId: TEAM, teamName: "Us", side: "home", scope: "ALL", window: 5, cutoff: KICKOFF });
  eq("last 5 sequence W D W L D", s5.matches.map((m) => m.result).join(""), "WDWLD");
  eq("last 5 opponent + venue resolved from our perspective", [s5.matches[1].opponent, s5.matches[1].venue, s5.matches[1].opponentApiId], ["T2", "away", 2]);
}

console.log("form summary (scopes and edge cases):");
{
  const home = formSummary({ history: H, teamApiId: TEAM, teamName: "Us", side: "home", scope: "VENUE", window: 10, cutoff: KICKOFF });
  eq("VENUE for the home side = home matches only (6 of the 12)", [home.played, home.matches.every((m) => m.venue === "home")], [6, true]);
  const away = formSummary({ history: H, teamApiId: TEAM, teamName: "Us", side: "away", scope: "VENUE", window: 5, cutoff: KICKOFF });
  eq("VENUE for the away side = away matches only, capped at window", [away.played, away.matches.every((m) => m.venue === "away")], [5, true]);
  const comp = formSummary({ history: H, teamApiId: TEAM, teamName: "Us", side: "home", scope: "COMPETITION", window: 10, cutoff: KICKOFF, leagueApiId: 39, leagueName: "Premier League" });
  eq("COMPETITION excludes the cup tie", [comp.played, comp.matches.some((m) => m.competitionApiId === 48)], [10, false]);
  const noLeague = formSummary({ history: H, teamApiId: TEAM, teamName: "Us", side: "home", scope: "COMPETITION", window: 10, cutoff: KICKOFF, leagueApiId: null });
  eq("COMPETITION without a league id → empty, not 'all'", noLeague.played, 0);

  const cutoff = formSummary({ history: H, teamApiId: TEAM, teamName: "Us", side: "home", scope: "ALL", window: 5, cutoff: new Date("2026-10-20T00:00:00Z") });
  eq("only matches before kickoff (a finished fixture's own result is never in its form)", cutoff.matches[0].date.slice(0, 10), "2026-10-19");

  const dup = [...H.slice(0, 3), { ...H[0] }, { ...H[1] }];
  eq("duplicate provider ids counted once", formSummary({ history: dup, teamApiId: TEAM, teamName: "Us", side: "home", scope: "ALL", window: 10, cutoff: KICKOFF }).played, 3);

  const withFriendly = [fx({ date: "2026-11-10T12:00:00Z", homeId: TEAM, awayId: 99, home: 6, away: 0, leagueId: 667, leagueName: "Club Friendlies" }), ...H.slice(0, 4)];
  eq("friendlies excluded", formSummary({ history: withFriendly, teamApiId: TEAM, teamName: "Us", side: "home", scope: "ALL", window: 5, cutoff: KICKOFF }).played, 4);

  const withPostponed = [fx({ date: "2026-11-10T12:00:00Z", homeId: TEAM, awayId: 98, home: null, away: null, status: "PST" }), ...H.slice(0, 3)];
  eq("postponed fixture skipped (not a 0-0)", formSummary({ history: withPostponed, teamApiId: TEAM, teamName: "Us", side: "home", scope: "ALL", window: 5, cutoff: KICKOFF }).played, 3);

  const withUnverified = [...H.slice(0, 2), fx({ date: "2026-10-30T12:00:00Z", homeId: TEAM, awayId: 97, home: null, away: null, status: "FT" }), ...H.slice(2, 6)];
  eq("finished match without a verified score ENDS the sample (no gap-joining)", formSummary({ history: withUnverified, teamApiId: TEAM, teamName: "Us", side: "home", scope: "ALL", window: 10, cutoff: KICKOFF }).played, 2);

  const withAwarded = [H[0], fx({ date: "2026-11-05T12:00:00Z", homeId: TEAM, awayId: 96, home: 3, away: 0, status: "AWD" }), ...H.slice(1, 5)];
  eq("awarded result ends the sample (no football was played)", formSummary({ history: withAwarded, teamApiId: TEAM, teamName: "Us", side: "home", scope: "ALL", window: 10, cutoff: KICKOFF }).played, 1);

  const short = formSummary({ history: H.slice(0, 3), teamApiId: TEAM, teamName: "Us", side: "home", scope: "ALL", window: 10, cutoff: KICKOFF });
  eq("fewer than the window → the real sample, never padded", [short.played, short.window, short.matches.length, short.btts], [3, 10, 3, { n: 1, d: 3 }]);

  const none = formSummary({ history: null, teamApiId: TEAM, teamName: "Us", side: "home", scope: "ALL", window: 5, cutoff: KICKOFF });
  eq("no history → nulls, never zeros", [none.played, none.avgFor, none.btts, none.cleanSheets, none.ppg, none.from], [0, null, null, null, null, null]);
  eq("garbage history tolerated", formSummary({ history: [{ id: "x" }, 5, null], teamApiId: TEAM, teamName: "Us", side: "home", scope: "ALL", window: 5, cutoff: KICKOFF }).played, 0);

  const aet = [fx({ date: "2026-11-10T12:00:00Z", homeId: TEAM, awayId: 95, home: 1, away: 1, status: "PEN" })];
  eq("penalty shoot-out judged on regulation score (a draw)", formSummary({ history: aet, teamApiId: TEAM, teamName: "Us", side: "home", scope: "ALL", window: 5, cutoff: KICKOFF }).matches[0].result, "D");

  const other = [fx({ date: "2026-11-10T12:00:00Z", homeId: 1, awayId: 2, home: 1, away: 0 })];
  eq("rows not involving the team are ignored", formSummary({ history: other, teamApiId: TEAM, teamName: "Us", side: "home", scope: "ALL", window: 5, cutoff: KICKOFF }).played, 0);

  eq("scope descriptions", [scopeDescription("ALL", "home", null), scopeDescription("VENUE", "home", null), scopeDescription("VENUE", "away", null), scopeDescription("COMPETITION", "home", "Serie A")], ["all competitions", "home matches only", "away matches only", "Serie A only"]);
}

console.log("form grid + comparison:");
{
  const AWAY = 77;
  const awayHistory = [
    fx({ date: "2026-11-08T15:00:00Z", homeId: 50, awayId: AWAY, home: 1, away: 0 }), // L 0-1 away
    fx({ date: "2026-11-01T15:00:00Z", homeId: AWAY, awayId: 51, home: 0, away: 0 }), // D 0-0 home
  ];
  const grid = formGrid({ homeHistory: H, awayHistory, homeTeamApiId: TEAM, awayTeamApiId: AWAY, homeTeam: "Us", awayTeam: "Them", kickoff: KICKOFF, leagueApiId: 39, leagueName: "Premier League" });
  eq("grid has every scope × window", Object.keys(grid).flatMap((s) => Object.keys((grid as any)[s]).map((w) => `${s}${w}`)), ["ALL5", "ALL10", "VENUE5", "VENUE10", "COMPETITION5", "COMPETITION10"]);
  eq("away side's VENUE = its away matches (1)", grid.VENUE[10].away.played, 1);
  const rows = comparisonRows(grid.ALL[5].home, grid.ALL[5].away);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  eq("comparison rows in order", rows.map((r) => r.key), ["record", "scored", "conceded", "cleanSheets", "failedToScore", "btts", "over05", "over15", "over25", "over35"]);
  eq("record formatted", [formatComparisonValue(byKey.record.home), formatComparisonValue(byKey.record.away)], ["2-2-1", "0-1-1"]);
  eq("rates formatted with n/d", [formatComparisonValue(byKey.cleanSheets.home), formatComparisonValue(byKey.cleanSheets.away)], ["2 of 5 · 40%", "1 of 2 · 50%"]);
  eq("rate bars are the true fraction", [byKey.cleanSheets.homeBar, byKey.cleanSheets.awayBar], [0.4, 0.5]);
  // home avgFor (2+0+3+1+1)/5 = 1.4, away 0/2 = 0 → scale max(1,1.4,0)=1.4
  eq("average bars scaled to the larger side", [byKey.scored.homeBar, byKey.scored.awayBar], [1, 0]);
  const emptyRows = comparisonRows(grid.ALL[5].home, formSummary({ history: [], teamApiId: AWAY, teamName: "Them", side: "away", scope: "ALL", window: 5, cutoff: KICKOFF }));
  const e = Object.fromEntries(emptyRows.map((r) => [r.key, r]));
  eq("missing side: no bar, '—' text (not 0%)", [e.btts.awayBar, formatComparisonValue(e.btts.away), formatComparisonValue(e.record.away), formatComparisonValue(e.scored.away)], [null, "—", "—", "—"]);
}

console.log("payload-light source = full grid:");
{
  const AWAY = 77;
  const awayHistory = [fx({ date: "2026-11-08T15:00:00Z", homeId: 50, awayId: AWAY, home: 1, away: 0 }), fx({ date: "2026-11-01T15:00:00Z", homeId: AWAY, awayId: 51, home: 0, away: 0 })];
  const args = { homeHistory: shuffled, awayHistory, homeTeamApiId: TEAM, awayTeamApiId: AWAY, homeTeam: "Us", awayTeam: "Them", kickoff: KICKOFF, leagueApiId: 39, leagueName: "Premier League" };
  const grid = formGrid(args);
  const src = formSource(args);
  let same = true;
  for (const scope of ["ALL", "VENUE", "COMPETITION"] as const)
    for (const w of [5, 10] as const) {
      const a = summarizeForm(src[scope].home, { teamApiId: TEAM, scope, window: w });
      const b = summarizeForm(src[scope].away, { teamApiId: AWAY, scope, window: w });
      if (JSON.stringify(a) !== JSON.stringify(grid[scope][w].home) || JSON.stringify(b) !== JSON.stringify(grid[scope][w].away)) same = false;
    }
  check("every window x scope summary derived client-side equals the server computation", same);
  check("source holds at most 10 matches per team per scope", Object.values(src).every((x) => x.home.length <= 10 && x.away.length <= 10));
}

console.log("head-to-head:");
{
  const HOME = 10, AWAY = 20;
  let id = 1;
  const m = (date: string, h: number, a: number, hg: number, ag: number): H2HMeeting => ({ fixtureApiId: id++, date, leagueName: "Premier League", leagueApiId: 39, homeTeamApiId: h, homeTeam: `T${h}`, awayTeamApiId: a, awayTeam: `T${a}`, homeGoals: hg, awayGoals: ag });
  const list = [
    m("2026-04-01T15:00:00Z", HOME, AWAY, 2, 1), // home side hosted, won
    m("2025-12-01T15:00:00Z", AWAY, HOME, 1, 1), // away hosted, draw
    m("2025-04-01T15:00:00Z", AWAY, HOME, 0, 2), // home side won away
    m("2024-12-01T15:00:00Z", HOME, AWAY, 0, 1), // home side lost at home
    m("2024-04-01T15:00:00Z", HOME, AWAY, 3, 3), // draw
    m("2023-12-01T15:00:00Z", AWAY, HOME, 2, 0), // home side lost away (6th)
  ];
  const dup = { ...list[0] };
  const future = m("2027-01-01T15:00:00Z", HOME, AWAY, 0, 0);
  const stranger = m("2026-05-01T15:00:00Z", HOME, 99, 5, 0);
  const s5 = h2hWindow([...list, dup, future, stranger], HOME, AWAY, 5, KICKOFF);
  eq("5 meetings: duplicate id, future meeting and third team excluded", s5.played, 5);
  eq("newest first", s5.meetings[0].date.slice(0, 10), "2026-04-01");
  eq("wins/draws from TODAY's sides' perspective (2-2-1)", [s5.homeWins, s5.draws, s5.awayWins], [2, 2, 1]);
  eq("goals by today's sides wherever played (2+1+2+0+3=8 / 1+1+0+1+3=6)", [s5.homeGoals, s5.awayGoals], [8, 6]);
  eq("home side as host / as visitor", [s5.homeAsHost, s5.homeAsVisitor], [{ w: 1, d: 1, l: 1 }, { w: 1, d: 1, l: 0 }]);
  eq("BTTS 3 of 5 (2-1, 1-1, 3-3)", s5.btts, { n: 3, d: 5 });
  eq("over 2.5 2 of 5 (2-1, 3-3)", s5.over25, { n: 2, d: 5 });
  eq("avg goals 14/5", s5.avgGoals, 2.8);
  const s10 = h2hWindow(list, HOME, AWAY, 10, KICKOFF);
  eq("window 10 with only 6 meetings → 6, not padded", [s10.played, s10.window], [6, 10]);
  const empty = h2hWindow([], HOME, AWAY, 5, KICKOFF);
  eq("no meetings → nulls", [empty.played, empty.btts, empty.over25, empty.avgGoals, empty.from], [0, null, null, null, null]);
  const bad = h2hWindow([{ ...list[0], homeGoals: -1 as number }, { ...list[1], date: "nonsense" }], HOME, AWAY, 5, KICKOFF);
  eq("invalid score / date dropped", bad.played, 0);
  const finishedCutoff = h2hWindow(list, HOME, AWAY, 5, new Date("2026-04-01T15:00:00Z"));
  eq("a completed fixture's own meeting is not part of its H2H", finishedCutoff.meetings[0].date.slice(0, 10), "2025-12-01");
}

console.log("table context:");
{
  const row = (teamId: number, rank: number, points: number, played = 12, extra: Partial<LeagueStandingRow> = {}): LeagueStandingRow => ({ rank, teamId, teamName: `T${teamId}`, teamLogo: null, points, played, win: 6, draw: 3, loss: 3, goalsFor: 20, goalsAgainst: 12, form: null, ...extra });
  const table = [row(1, 1, 30), row(10, 3, 24, 12, { home: { played: 6, win: 5, draw: 1, loss: 0, goalsFor: 14, goalsAgainst: 3 } }), row(5, 4, 22), row(20, 6, 19, 12, { away: { played: 6, win: 2, draw: 1, loss: 3, goalsFor: 7, goalsAgainst: 9 } })];
  const ctx = tableContext(table, 10, 20);
  check("both teams found", ctx.kind === "table");
  if (ctx.kind === "table") {
    eq("points gap and places apart", [ctx.pointsGap, ctx.placesApart, ctx.grouped], [5, 3, false]);
    eq("venue records from the table's splits", [ctx.home.venueRecord?.label, ctx.home.venueRecord?.w, ctx.away.venueRecord?.label, ctx.away.venueRecord?.l], ["Home", 5, "Away", 3]);
    eq("goal difference", ctx.home.goalDifference, 8);
  }
  eq("sentence states arithmetic only", tableSentence(ctx, "Home FC", "Away FC"), "Home FC are 5 points and 3 places ahead of Away FC.");
  eq("level on points", tableSentence(tableContext([row(10, 2, 20), row(20, 3, 20)], 10, 20), "A", "B"), "A and B are level on 20 points, 1 place apart.");
  eq("away team ahead", tableSentence(tableContext([row(10, 5, 10), row(20, 2, 21)], 10, 20), "A", "B"), "B are 11 points and 3 places ahead of A.");
  eq("no table (cup) → none", tableContext(null, 10, 20), { kind: "none", reason: "no-table" });
  eq("a team missing from the table (wrong competition) → none, never half-shown", tableContext(table, 10, 999), { kind: "none", reason: "teams-missing" });
  eq("season not started → none", tableContext([row(10, 1, 0, 0), row(20, 2, 0, 0)], 10, 20), { kind: "none", reason: "not-started" });
  const grouped = tableContext([row(10, 1, 9), row(30, 2, 6), row(20, 1, 7), row(40, 2, 3)], 10, 20);
  eq("grouped table detected (duplicate ranks) → no 'places apart'", grouped.kind === "table" ? [grouped.grouped, grouped.placesApart] : null, [true, null]);
  eq("grouped sentence avoids places", tableSentence(grouped, "A", "B"), "A have 2 more points than B.");
  const noSplits = tableContext([row(10, 1, 9), row(20, 2, 7)], 10, 20);
  eq("rows cached before splits → no venue record (not zeros)", noSplits.kind === "table" ? [noSplits.home.venueRecord, noSplits.away.venueRecord] : null, [null, null]);
}

console.log("match state:");
{
  const now = new Date("2026-11-14T18:00:00Z");
  const past = new Date("2026-11-14T15:00:00Z");
  const future = new Date("2026-11-15T15:00:00Z");
  eq("PST is postponed even with a stored score", matchState({ statusShort: "PST", finalScore: { home: 1, away: 0 }, kickoff: past, now }), "postponed");
  eq("CANC cancelled", matchState({ statusShort: "CANC", kickoff: past, now }), "cancelled");
  eq("ABD abandoned", matchState({ statusShort: "ABD", kickoff: past, now }), "abandoned");
  eq("AWD awarded", matchState({ statusShort: "AWD", kickoff: past, now }), "awarded");
  eq("SUSP suspended", matchState({ statusShort: "SUSP", kickoff: past, now }), "suspended");
  eq("2H live", matchState({ statusShort: "2H", kickoff: past, now }), "live");
  eq("HT live", matchState({ statusShort: "HT", kickoff: past, now }), "live");
  eq("AET finished", matchState({ statusShort: "AET", kickoff: past, now }), "finished");
  eq("NS before kickoff scheduled", matchState({ statusShort: "NS", kickoff: future, now }), "scheduled");
  eq("NS after kickoff (stale code) → unknown, not live", matchState({ statusShort: "NS", kickoff: past, now }), "unknown");
  eq("no code + settled score → finished", matchState({ finalScore: { home: 2, away: 2 }, kickoff: past, now }), "finished");
  eq("no code, future → scheduled", matchState({ kickoff: future, now }), "scheduled");
  eq("no code, past, nothing known → unknown", matchState({ kickoff: past, now }), "unknown");
}

console.log("completed-match record:");
{
  const raw = {
    fixture: { id: 555, status: { short: "FT", elapsed: 90 } },
    teams: { home: { id: 10 }, away: { id: 20 } },
    score: { halftime: { home: 1, away: 0 }, fulltime: { home: 2, away: 1 }, extratime: { home: null, away: null }, penalty: { home: null, away: null } },
    events: [
      { time: { elapsed: 67, extra: null }, team: { id: 20 }, player: { name: "B. Striker" }, assist: { name: null }, type: "Goal", detail: "Normal Goal" },
      { time: { elapsed: 12, extra: null }, team: { id: 10 }, player: { name: "A. Forward" }, assist: { name: "A. Mid" }, type: "Goal", detail: "Normal Goal" },
      { time: { elapsed: 45, extra: 2 }, team: { id: 10 }, player: { name: "A. Defender" }, assist: {}, type: "Card", detail: "Yellow Card" },
      { time: { elapsed: 80, extra: null }, team: { id: 20 }, player: { name: "B. Back" }, type: "Card", detail: "Red Card" },
      { time: { elapsed: 88, extra: null }, team: { id: 10 }, player: { name: "A. Forward" }, assist: { name: "A. Sub" }, type: "subst", detail: "Substitution 1" },
      { time: { elapsed: 90, extra: 4 }, team: { id: 10 }, player: { name: "A. Wing" }, type: "Goal", detail: "Penalty" },
      { time: { elapsed: 70 }, team: { id: 99 }, player: { name: "Stranger" }, type: "Goal", detail: "Normal Goal" }, // other team id → dropped
      { time: { elapsed: "x" }, team: { id: 10 }, type: "Goal", detail: "Normal Goal" }, // bad minute → dropped
      { time: { elapsed: 30 }, team: { id: 20 }, player: { name: "B. Own" }, type: "Goal", detail: "Own Goal" },
      { time: { elapsed: 55 }, team: { id: 20 }, player: { name: "B. Miss" }, type: "Goal", detail: "Missed Penalty" },
    ],
    statistics: [
      { team: { id: 20 }, statistics: [{ type: "Ball Possession", value: "41%" }, { type: "Total Shots", value: 8 }] },
      { team: { id: 10 }, statistics: [{ type: "Ball Possession", value: "59%" }, { type: "Total Shots", value: 15 }, { type: "Shots on Goal", value: null }] },
    ],
  };
  const r = compactFixtureResult(raw, new Date("2026-11-14T17:00:00Z"))!;
  eq("scores", [r.halftime, r.fulltime, r.extratime, r.penalty], [{ home: 1, away: 0 }, { home: 2, away: 1 }, null, null]);
  eq("events: invalid dropped, sorted by minute", r.events!.map((e) => `${e.minute}${e.extra ? "+" + e.extra : ""}:${e.kind}`), ["12:goal", "30:own-goal", "45+2:yellow-card", "55:missed-penalty", "67:goal", "80:red-card", "88:substitution", "90+4:penalty-goal"]);
  eq("assist / player on kept", r.events![0].related, "A. Mid");
  eq("statistics oriented to home/away even when the provider lists away first", r.statistics!.map((s) => [s.type, s.home, s.away]), [["Ball Possession", "59%", "41%"], ["Total Shots", 15, 8]]);
  eq("minute label", [minuteLabel({ minute: 45, extra: 2 }), minuteLabel({ minute: 12, extra: null })], ["45+2'", "12'"]);
  const slate = compactFixtureResult({ fixture: { id: 556, status: { short: "PST" } }, score: { halftime: { home: null, away: null } } }, new Date());
  eq("date-slate row: no events/statistics keys → null (absent, not empty)", [slate?.status, slate?.events, slate?.statistics, slate?.halftime], ["PST", null, null, null]);
  eq("no id → nothing stored", compactFixtureResult({ fixture: { status: { short: "FT" } } }, new Date()), null);
  eq("no status → nothing stored", compactFixtureResult({ fixture: { id: 1 } }, new Date()), null);
  eq("read back with matching id", readFixtureResult(r, 555)?.fixtureApiId, 555);
  eq("read back for a DIFFERENT fixture id → ignored", readFixtureResult(r, 777), null);
  eq("malformed stored record → ignored", readFixtureResult({ fixtureApiId: "x" }, null), null);
  const later = compactFixtureResult({ fixture: { id: 555, status: { short: "FT" } }, score: { fulltime: { home: 2, away: 1 } } }, new Date())!;
  const merged = mergeFixtureResult(r, later);
  eq("merge: a slimmer later capture keeps stored events/stats/halftime", [merged.events?.length, merged.statistics?.length, merged.halftime], [8, 2, { home: 1, away: 0 }]);
  eq("merge across fixture ids replaces", mergeFixtureResult(r, { ...later, fixtureApiId: 9 }).events, null);
  eq("result labels", [resultLabel(r), resultLabel({ ...r, status: "AET" }), resultLabel({ ...r, status: "PEN", penalty: { home: 4, away: 3 } })], ["Full time", "After extra time", "Penalties 4-3"]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
