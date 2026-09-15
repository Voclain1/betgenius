import assert from "node:assert/strict";
import { calculateInsights, isInsightFixture, type InsightFixture } from "../src/lib/insights";
import { compactFixture, insightsForTarget } from "../src/lib/insightRefresh";

const TEAM = 1;
let nextId = 100;
/** A completed match for TEAM, `daysAgo` before the cutoff, from TEAM's point of view. */
function played(daysAgo: number, own: number, against: number, extra: Partial<InsightFixture> & { venue?: "home" | "away" } = {}): InsightFixture {
  const { venue = "home", ...rest } = extra;
  const home = venue === "home";
  return {
    id: ++nextId,
    date: new Date(Date.UTC(2026, 8, 14) - daysAgo * 86_400_000).toISOString(),
    status: "FT",
    leagueId: 39,
    leagueName: "Premier League",
    homeId: home ? TEAM : 5000 + nextId,
    homeName: home ? "Team A" : `Opponent ${daysAgo}`,
    awayId: home ? 5000 + nextId : TEAM,
    awayName: home ? `Opponent ${daysAgo}` : "Team A",
    home: home ? own : against,
    away: home ? against : own,
    ...rest,
  };
}
// Guards the helper itself: a row the validator rejects would make every
// "skipped"/"excluded" assertion below pass for the wrong reason.
assert.ok([played(3.5, 1, 0), played(2, 1, 0, { venue: "away" })].every(isInsightFixture), "test fixtures are well-formed");
const cutoff = new Date(Date.UTC(2026, 8, 14));
const base = { teamApiId: TEAM, teamName: "Team A", scope: "ALL" as const, cutoff };
const find = (rows: ReturnType<typeof calculateInsights>, type: string) => rows.find((r) => r.type === type);

// --- Regulation time, via the same breakdown validation settlement uses ---
const aet = compactFixture({
  fixture: { id: 1, date: "2026-09-01T18:00:00Z", status: { short: "AET" } },
  league: { id: 2, name: "Cup", country: "", season: 2026 },
  teams: { home: { id: TEAM, name: "Team A" }, away: { id: 5, name: "B" } },
  goals: { home: 3, away: 2 },
  score: { fulltime: { home: 2, away: 2 }, extratime: { home: 1, away: 0 }, penalty: { home: null, away: null } },
});
assert.deepEqual([aet?.home, aet?.away], [2, 2], "AET is judged on the 90-minute score, not the extra-time result");
const pen = compactFixture({
  fixture: { id: 2, date: "2026-09-01T18:00:00Z", status: { short: "PEN" } },
  league: { id: 2, name: "Cup", country: "", season: 2026 },
  teams: { home: { id: TEAM, name: "Team A" }, away: { id: 5, name: "B" } },
  goals: { home: 1, away: 1 },
  score: { fulltime: { home: 1, away: 1 }, extratime: { home: 0, away: 0 }, penalty: { home: 3, away: 4 } },
});
assert.deepEqual([pen?.home, pen?.away], [1, 1], "a shootout defeat is a regulation-time draw");
const inconsistent = compactFixture({
  fixture: { id: 3, date: "2026-09-01T18:00:00Z", status: { short: "FT" } },
  league: { id: 2, name: "Cup", country: "", season: 2026 },
  teams: { home: { id: TEAM, name: "Team A" }, away: { id: 5, name: "B" } },
  goals: { home: 2, away: 0 },
  score: { fulltime: { home: 1, away: 0 } },
});
assert.equal(inconsistent?.home, null, "an internally inconsistent breakdown is stored as unverified");

// --- Regression: the trimmed TeamEnrichmentCache.lastFixtures shape must not throw ---
const legacy = Array.from({ length: 6 }, () => ({ opponent: "X", result: "W", date: "2026-09-01T12:00:00Z", venue: "home", goalsFor: 2, goalsAgainst: 0 }));
assert.deepEqual(calculateInsights(legacy, base), [], "malformed rows are ignored rather than crashing the worker");
assert.deepEqual(calculateInsights(null, base), []);

// --- Exact vs at-least streaks ---
const sixWins = [1, 2, 3, 4, 5, 6].map((d) => played(d, 2, 0));
const unbroken = calculateInsights(sixWins, base);
assert.equal(find(unbroken, "WIN_STREAK")?.count, 6);
assert.equal(find(unbroken, "WIN_STREAK")?.exact, false, "a run that uses the whole history is a minimum");
assert.match(find(unbroken, "WIN_STREAK")!.explanation, /^Won at least 6 matches in a row\.$/);
assert.equal(find(unbroken, "UNBEATEN_STREAK"), undefined, "unbeaten equal to the winning run is not repeated");

const broken = calculateInsights([...sixWins, played(7, 0, 1)], base);
const win = find(broken, "WIN_STREAK")!;
assert.equal(win.exact, true, "an older verified defeat proves the run's length");
assert.equal(win.explanation, "Won 6 matches in a row.");
assert.equal(win.matches.length, 7, "evidence lists the run plus the match that ended it");
assert.equal(win.matches.at(-1)?.breaksStreak, true);

const drawThenWins = calculateInsights([played(1, 1, 0), played(2, 1, 1), played(3, 2, 0), played(4, 3, 1), played(5, 1, 0), played(6, 0, 2)], base);
assert.equal(find(drawThenWins, "WIN_STREAK"), undefined, "a one-match winning run is below the minimum");
assert.equal(find(drawThenWins, "UNBEATEN_STREAK")?.count, 5);
assert.equal(find(drawThenWins, "UNBEATEN_STREAK")?.exact, true);

// --- What is skipped and what ends the history ---
const withPostponed = [...sixWins.slice(0, 3), { ...played(3.5, 0, 0), status: "PST", home: null, away: null }, ...sixWins.slice(3), played(7, 0, 1)];
assert.equal(find(calculateInsights(withPostponed, base), "WIN_STREAK")?.count, 6, "a postponed fixture is not a match and does not break a run");

const withFriendly = [...sixWins.slice(0, 3), played(3.5, 0, 4, { leagueName: "Friendlies Clubs", leagueId: 667 }), ...sixWins.slice(3), played(7, 0, 1)];
assert.equal(find(calculateInsights(withFriendly, base), "WIN_STREAK")?.count, 6, "friendlies are excluded");

const withUnverified = [...sixWins.slice(0, 3), played(3.5, 0, 0, { home: null, away: null }), ...sixWins.slice(3)];
assert.deepEqual(calculateInsights(withUnverified, base), [], "an unverifiable completed match ends the history, leaving too few matches");

const withAwarded = [...sixWins, { ...played(6.5, 3, 0), status: "AWD" }, played(7, 0, 1)];
assert.equal(find(calculateInsights(withAwarded, base), "WIN_STREAK")?.exact, false, "an awarded result cannot prove where a run ended");

// --- Cutoff and duplicates ---
const future = played(-1, 0, 5);
const duplicate = { ...sixWins[0] };
assert.equal(find(calculateInsights([future, duplicate, ...sixWins], base), "WIN_STREAK")?.count, 6, "future fixtures and duplicate ids are ignored");

// --- Scope is applied before the minimum sample ---
const mixedVenues = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => played(d, 2, 1, { venue: d % 2 ? "home" : "away" }));
assert.equal(calculateInsights(mixedVenues, { ...base, scope: "HOME" }).length, 0, "four home matches are below the minimum");
assert.equal(find(calculateInsights(mixedVenues, base), "WIN_STREAK")?.count, 8);
assert.match(find(calculateInsights([...mixedVenues, ...[9, 11, 13].map((d) => played(d, 2, 1))], { ...base, scope: "HOME" }), "WIN_STREAK")!.explanation, / at home\.$/);
assert.equal(calculateInsights(mixedVenues, { ...base, scope: "COMPETITION" }).length, 0, "COMPETITION scope needs a league");

// --- Frequencies use the ten most recent verified matches ---
const twelve = [
  ...[1, 2, 3, 4, 5, 6, 7].map((d) => played(d, 2, 1)),
  ...[8, 9, 10].map((d) => played(d, 0, 0)),
  ...[11, 12].map((d) => played(d, 3, 3)),
];
const freq = calculateInsights(twelve, base);
assert.equal(find(freq, "OVER_25")?.explanation, "Over 2.5 goals in 7 of the last 10 matches.");
assert.equal(find(freq, "OVER_25")?.matches.length, 10);
assert.equal(find(freq, "BTTS")?.count, 7);
assert.equal(find(freq, "CLEAN_SHEET"), undefined, "three clean sheets in ten is below 70%");

// --- insightsForTarget: duplicate scopes collapse ---
const target = { teamApiId: TEAM, teamName: "Stored Name", predictionId: "p1", venue: "HOME" as const, kickoff: new Date(Date.UTC(2026, 8, 16)), leagueApiId: 39, leagueName: "EPL" };
const forTarget = insightsForTarget(target, [...sixWins, played(7, 0, 1)], cutoff);
assert.equal(forTarget.filter((e) => e.type === "WIN_STREAK").length, 1, "an all-league history does not repeat ALL as COMPETITION");
assert.equal(forTarget[0].teamName, "Team A", "the provider's team name is preferred over the stored one");
const awayForm = [1, 2, 3, 4, 5, 6, 7].map((d) => played(d, 0, 2, { venue: "away" }));
assert.ok(!insightsForTarget(target, [...sixWins, ...awayForm], cutoff).some((e) => e.scope === "AWAY"), "a team at home is not described by its away form");
assert.ok(insightsForTarget({ ...target, venue: "AWAY" }, [...sixWins, ...awayForm], cutoff).some((e) => e.scope === "AWAY"));

console.log("insight calculation checks passed");
