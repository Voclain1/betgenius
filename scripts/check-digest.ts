/**
 * Offline self-checks for the context digest and the stored-context versioning.
 *
 * No network, no database, no API quota — every case is built from inline
 * payloads shaped like the live api-football responses this was written
 * against (see scripts/validate-digest.ts for the on-network A/B harness).
 * That makes it safe to run on every change, which matters because the rules
 * being checked here are the ones that silently corrupt a prediction when they
 * regress: stale injuries presented as current, an unplayed season presented as
 * form, and a v1 stored context becoming unreadable.
 *
 * Run: npx tsx scripts/check-digest.ts
 */
import {
  buildMatchDigest,
  buildTeamDigest,
  buildStandingsContext,
  selectCurrentAvailability,
  classifyAbsence,
  isDigestEmpty,
} from "../src/lib/ai/digest";
import { buildStoredContext, parseStoredContext } from "../src/lib/ai/context";
import type { StandingsEntry, FixtureRow } from "../src/lib/football/api-football";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
  } else {
    failures.push(`${label}${detail === undefined ? "" : `\n      got: ${JSON.stringify(detail)}`}`);
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), actual);
}

// ---------------------------------------------------------------------------
// Absence classification and the season-log -> current-list collapse.
// Live shape: one record per (player, fixture), duplicated within a matchday.
// ---------------------------------------------------------------------------
const injuryRow = (name: string, reason: string, date: string) => ({
  player: { id: name.length, name, reason, type: "Missing Fixture" },
  fixture: { id: 1, date },
});

const rawInjuries = [
  injuryRow("A. Old", "Knee Injury", "2026-04-05T12:00:00+00:00"),
  injuryRow("B. Current", "Hamstring Injury", "2026-08-16T12:00:00+00:00"),
  injuryRow("B. Current", "Hamstring Injury", "2026-08-16T12:00:00+00:00"), // duplicate within the day
  injuryRow("C. Banned", "Yellow Cards", "2026-08-16T12:00:00+00:00"),
  injuryRow("D. Benched", "Inactive", "2026-08-16T12:00:00+00:00"),
];

const avail = selectCurrentAvailability(rawInjuries);
eq("availability: drops prior matchdays and dedupes within the day", avail.entries.map((e) => e.player), [
  "B. Current",
  "C. Banned",
  "D. Benched",
]);
eq("availability: asOf is the latest matchday", avail.asOf, "2026-08-16");
eq("availability: kinds are classified", avail.entries.map((e) => e.kind), ["injury", "suspension", "unavailable"]);

eq("classifyAbsence: card reasons are suspensions", classifyAbsence("Yellow Cards"), "suspension");
eq("classifyAbsence: Inactive is not an injury", classifyAbsence("Inactive"), "unavailable");
eq("classifyAbsence: bare Injury is an injury", classifyAbsence("Injury"), "injury");
eq("classifyAbsence: unknown text defaults to injury", classifyAbsence("Groin Injury"), "injury");
eq("availability: empty input yields no asOf (unknown, not 'everyone fit')", selectCurrentAvailability([]).asOf, null);

// ---------------------------------------------------------------------------
// Unplayed-season suppression. Live api-football returns a fully-populated
// object of zeros before the first match, which reads as fact if passed on.
// ---------------------------------------------------------------------------
const zeroStats = {
  form: null,
  fixtures: { played: { home: 0, away: 0, total: 0 }, wins: { total: 0 }, draws: { total: 0 }, loses: { total: 0 } },
  goals: { for: { total: { total: 0 }, average: { total: "0.0", home: "0.0", away: "0.0" } }, against: { total: { total: 0 }, average: { total: "0.0" } } },
  clean_sheet: { total: 0, home: 0, away: 0 },
  failed_to_score: { total: 0, home: 0, away: 0 },
  biggest: { streak: { wins: 0, draws: 0, loses: 0 } },
  lineups: [],
};

const unplayed = buildTeamDigest({
  name: "Arsenal",
  apiId: 42,
  statistics: zeroStats,
  standingsRow: { rank: 1, team: { id: 42, name: "Arsenal" }, points: 0, goalsDiff: 0, all: { played: 0, win: 0, draw: 0, lose: 0, goals: { for: 0, against: 0 } } } as StandingsEntry,
});
eq("unplayed season: no fabricated rank", unplayed.rank, null);
eq("unplayed season: no fabricated record", unplayed.overall, null);
eq("unplayed season: no 0.0 goal average", unplayed.goalsForAvg, null);
eq("unplayed season: no 0 clean sheets", unplayed.cleanSheets, null);
eq("unplayed season: no 0 failed-to-score", unplayed.failedToScore, null);

const played = buildTeamDigest({
  name: "Sirius",
  apiId: 370,
  statistics: {
    ...zeroStats,
    form: "WWD",
    fixtures: { played: { home: 8, away: 9, total: 17 }, wins: { total: 13, home: 6, away: 7 }, draws: { total: 3, home: 2, away: 1 }, loses: { total: 1, home: 0, away: 1 } },
    goals: { for: { total: { total: 47, home: 23, away: 24 }, average: { total: "2.8", home: "2.9", away: "2.7" } }, against: { total: { total: 23 }, average: { total: "1.4" } } },
    clean_sheet: { total: 5, home: 2, away: 3 },
  },
});
eq("played season: record survives", played.overall?.played, 17);
eq("played season: averages parsed to numbers", played.goalsForAvg?.total, 2.8);
check("played season: averages are numeric not string", typeof played.goalsForAvg?.total === "number");
eq("played season: clean sheets survive", played.cleanSheets?.total, 5);

// ---------------------------------------------------------------------------
// Standings neighbourhood: merged windows, deduped, unplayed teams skipped.
// ---------------------------------------------------------------------------
const table: StandingsEntry[] = Array.from({ length: 20 }, (_, i) => ({
  rank: i + 1,
  team: { id: 100 + i, name: `Team${i + 1}` },
  points: 60 - i * 2,
  goalsDiff: 20 - i * 2,
  description: i < 4 ? "Promotion" : i >= 17 ? "Relegation" : null,
  all: { played: 23, win: 10, draw: 5, lose: 8, goals: { for: 30, against: 25 } },
}));

// 4th and 18th — two disjoint windows.
const disjoint = buildStandingsContext(table, [103, 117]);
eq("neighbourhood: disjoint windows keep both", disjoint?.neighbourhood.map((n) => n.rank), [1, 2, 3, 4, 5, 6, 7, 15, 16, 17, 18, 19, 20]);
eq("neighbourhood: fixture teams flagged", disjoint?.neighbourhood.filter((n) => n.isFixtureTeam).map((n) => n.rank), [4, 18]);
eq("neighbourhood: zone labels carried", disjoint?.neighbourhood.find((n) => n.rank === 18)?.zone, "Relegation");
check("neighbourhood: mid-table rows carry no zone key", !("zone" in (disjoint!.neighbourhood.find((n) => n.rank === 15)!)));

// 9th and 11th — overlapping windows must collapse, not duplicate.
const overlapping = buildStandingsContext(table, [108, 110]);
eq("neighbourhood: overlapping windows dedupe", overlapping?.neighbourhood.map((n) => n.rank), [6, 7, 8, 9, 10, 11, 12, 13, 14]);

eq("standings: league goals per game", buildStandingsContext(table, [])?.avgGoalsPerGame, Number((600 / (460 / 2)).toFixed(2)));
eq("standings: no window when no team ids given", buildStandingsContext(table, [])?.neighbourhood, []);

const unplayedTable = table.map((r) => ({ ...r, points: 0, all: { ...r.all, played: 0 } }));
eq("standings: whole table unplayed yields no context at all", buildStandingsContext(unplayedTable, [103]), null);

// One side has played, the other hasn't — only the played side gets a window.
const mixedTable = table.map((r, i) => (i === 17 ? { ...r, all: { ...r.all, played: 0 } } : r));
const mixed = buildStandingsContext(mixedTable, [103, 117]);
eq("neighbourhood: unplayed fixture team gets no window", mixed?.neighbourhood.map((n) => n.rank), [1, 2, 3, 4, 5, 6, 7]);

// ---------------------------------------------------------------------------
// Coverage flags: "unknown" must not be representable as "empty".
// ---------------------------------------------------------------------------
const bare = buildMatchDigest({
  home: "A", away: "B", league: "L", kickoff: "2026-08-21T19:00:00+00:00",
  homeApiId: null, awayApiId: null,
});
eq("coverage: nothing resolved reports all false", bare.coverage, { stats: false, form: false, availability: false, h2h: false, standings: false });
check("isDigestEmpty: true for a bare digest", isDigestEmpty(bare));
eq("coverage: no injury records means availability UNKNOWN, not fit", bare.teams.home.availabilityAsOf, null);

// ---------------------------------------------------------------------------
// v1 -> v2 stored-context compatibility. v1 rows never stored team ids, so the
// upgrade has to recover them by name from the standings/h2h payloads.
// ---------------------------------------------------------------------------
const h2hRaw: FixtureRow[] = [
  {
    fixture: { id: 900, date: "2026-04-27T17:00:00+00:00", status: { short: "FT" } },
    league: { id: 113, name: "Allsvenskan", country: "Sweden", season: 2026 },
    teams: { home: { id: 367, name: "BK Hacken" }, away: { id: 370, name: "Sirius" } },
    goals: { home: 2, away: 1 },
  } as FixtureRow,
];
const standingsRaw: StandingsEntry[] = [
  { rank: 1, team: { id: 370, name: "Sirius" }, points: 42, goalsDiff: 24, all: { played: 17, win: 13, draw: 3, lose: 1, goals: { for: 47, against: 23 } } },
  { rank: 3, team: { id: 367, name: "BK Hacken" }, points: 28, goalsDiff: 3, all: { played: 17, win: 8, draw: 4, lose: 5, goals: { for: 26, against: 23 } } },
];

const v1Row = {
  v: 1,
  home: "Sirius",
  away: "BK Hacken",
  league: "Allsvenskan",
  kickoff: "2026-08-21T17:00:00+00:00",
  homeContext: { statistics: null, injuries: rawInjuries, lastFixtures: null },
  awayContext: { statistics: null, injuries: [], lastFixtures: null },
  standings: standingsRaw,
  h2h: h2hRaw,
};

const upgraded = parseStoredContext(v1Row);
check("v1 compat: parses to a digest", upgraded !== null);
eq("v1 compat: v2 marker", upgraded?.v, 2);
eq("v1 compat: fixture identity preserved", [upgraded?.fixture.home, upgraded?.fixture.away], ["Sirius", "BK Hacken"]);
eq("v1 compat: home team id recovered by name from standings", upgraded?.teams.home.apiId, 370);
eq("v1 compat: away team id recovered by name", upgraded?.teams.away.apiId, 367);
eq("v1 compat: standings rank resolved via recovered id", upgraded?.teams.home.rank, 1);
check("v1 compat: h2h oriented with recovered ids", upgraded?.h2h != null);
eq("v1 compat: h2h counted for the home side", upgraded?.h2h?.stats.overall.teamBWins, 1);
eq("v1 compat: injuries collapsed on upgrade", upgraded?.teams.home.availability.length, 3);

const unrecoverable = parseStoredContext({ ...v1Row, standings: null, h2h: null });
check("v1 compat: still parses when ids cannot be recovered", unrecoverable !== null);
eq("v1 compat: unrecoverable ids are null, never guessed", unrecoverable?.teams.home.apiId, null);

// v2 round-trip
const fresh = buildMatchDigest({
  home: "Sirius", away: "BK Hacken", league: "Allsvenskan", kickoff: "2026-08-21T17:00:00+00:00",
  homeApiId: 370, awayApiId: 367,
  homeContext: { statistics: null, injuries: rawInjuries, lastFixtures: null },
  standings: standingsRaw, h2h: h2hRaw,
});
const stored = buildStoredContext(fresh);
eq("v2 round-trip: stored marker", stored.v, 2);
const reparsed = parseStoredContext(JSON.parse(JSON.stringify(stored)));
eq("v2 round-trip: survives JSON persistence unchanged", reparsed, fresh);

// Rejections
eq("stored context: null is rejected", parseStoredContext(null), null);
eq("stored context: unknown version is rejected", parseStoredContext({ v: 99 }), null);
eq("stored context: v2 without a digest is rejected", parseStoredContext({ v: 2 }), null);
eq("stored context: v1 missing fixture identity is rejected", parseStoredContext({ v: 1, home: "A" }), null);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("All digest and stored-context checks passed.");
