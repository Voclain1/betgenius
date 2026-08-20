/**
 * Offline self-checks for the match-page derived facts.
 *
 * No network, no database. What's pinned down here is the set of rules that
 * would put a wrong claim in front of a reader if they regressed:
 *
 *   - the four team-news states never collapsing into each other (in
 *     particular, a failed fetch never reading as "nobody is out"),
 *   - the staleness threshold actually firing,
 *   - rates being withheld below their sample size rather than shown,
 *   - missing data reading as null, never as zero.
 *
 * Run: npx tsx scripts/check-matchfacts.ts
 */
import {
  venueProfile, recentGoalRates, buildMatchFacts, isMatchFactsEmpty,
  availabilityFreshness, teamNewsState, confidenceBand, verdictLine,
} from "../src/lib/matchFacts";
import { buildAnalysis, parseAnalysis } from "../src/lib/predictionAnalysis";
import type { TeamDigest, AvailabilityEntry } from "../src/lib/ai/digest";

let passed = 0;
const failures: string[] = [];
const check = (l: string, c: boolean, got?: unknown) => {
  if (c) passed++;
  else failures.push(`${l}${got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`}`);
};
const eq = (l: string, a: unknown, b: unknown) => check(l, JSON.stringify(a) === JSON.stringify(b), a);

const NOW = new Date("2026-08-18T12:00:00Z");

function digest(over: Partial<TeamDigest> = {}): TeamDigest {
  return {
    name: "T", apiId: 1, rank: null, points: null,
    overall: null, home: null, away: null,
    goalsForAvg: null, goalsAgainstAvg: null, cleanSheets: null, failedToScore: null,
    form: null, streak: null, biggest: null, formations: [], cards: null, penalties: null,
    last5: [], availability: [], availabilityAsOf: null, keyPlayers: [],
    ...over,
  };
}

const fixture = (gf: number | null, ga: number | null, i: number) => ({
  opponent: `O${i}`, venue: "home" as const, result: "W", goalsFor: gf, goalsAgainst: ga, date: `2026-08-0${i + 1}`,
});

// --- Venue profile --------------------------------------------------------
const homeSide = digest({
  home: { played: 8, win: 6, draw: 2, loss: 0, goalsFor: 23, goalsAgainst: 11 },
  away: { played: 9, win: 7, draw: 1, loss: 1, goalsFor: 24, goalsAgainst: 12 },
  goalsForAvg: { total: 2.8, home: 2.9, away: 2.7 },
  goalsAgainstAvg: { total: 1.4, home: 1.4, away: 1.3 },
  cleanSheets: { total: 5, home: 2, away: 3 },
  failedToScore: { total: 1, home: 0, away: 1 },
});

const hp = venueProfile(homeSide, "home")!;
eq("venue profile: uses the HOME split for the home side", [hp.played, hp.win, hp.goalsFor], [8, 6, 23]);
eq("venue profile: prefers api-football's own per-venue average", hp.scoredPerGame, 2.9);
eq("venue profile: clean sheet pct against that venue's games", hp.cleanSheetPct, 25);

const ap = venueProfile(homeSide, "away")!;
eq("venue profile: away split is a different set of numbers", [ap.played, ap.goalsFor], [9, 24]);
eq("venue profile: away average used for the away split", ap.scoredPerGame, 2.7);

eq("venue profile: null digest yields null", venueProfile(null, "home"), null);
eq("venue profile: no split for that venue yields null", venueProfile(digest({ home: null }), "home"), null);
eq("venue profile: zero games played yields null, not zeroes",
  venueProfile(digest({ home: { played: 0, win: 0, draw: 0, loss: 0, goalsFor: 0, goalsAgainst: 0 } }), "home"), null);

// Below the sample floor, rates are withheld but the record is still shown.
const thin = venueProfile(digest({
  home: { played: 3, win: 2, draw: 1, loss: 0, goalsFor: 5, goalsAgainst: 2 },
  cleanSheets: { total: 2, home: 2, away: 0 },
  failedToScore: { total: 0, home: 0, away: 0 },
}), "home")!;
eq("thin sample: record still reported", [thin.played, thin.win], [3, 2]);
eq("thin sample: clean sheet rate withheld", thin.cleanSheetPct, null);
eq("thin sample: failed-to-score rate withheld", thin.failedToScorePct, null);
check("thin sample: per-game average still shown at 3 matches", thin.scoredPerGame !== null);

// A single match must not produce a per-game average. Casa Pia's only home game
// of the season was a 7-0 defeat, which reported "7 goals per game" against
// them until MIN_AVERAGE_SAMPLE existed.
const oneMatch = venueProfile(digest({
  home: { played: 1, win: 0, draw: 0, loss: 1, goalsFor: 0, goalsAgainst: 7 },
  goalsAgainstAvg: { total: 7, home: 7, away: null },
}), "home")!;
eq("one match: record still reported", [oneMatch.played, oneMatch.loss], [1, 1]);
eq("one match: scored-per-game withheld", oneMatch.scoredPerGame, null);
eq("one match: conceded-per-game withheld even when the API supplies it", oneMatch.concededPerGame, null);
eq("one match: combined rate cannot form from it",
  buildMatchFacts(digest({ home: { played: 1, win: 0, draw: 0, loss: 1, goalsFor: 0, goalsAgainst: 7 } }), homeSide).combinedGoalRate, null);

// Derivation fallback when the averages block is absent.
const derived = venueProfile(digest({ home: { played: 4, win: 2, draw: 1, loss: 1, goalsFor: 6, goalsAgainst: 4 } }), "home")!;
eq("no averages block: scored-per-game derived from the split", derived.scoredPerGame, 1.5);

// --- Recent goal rates ----------------------------------------------------
const five = digest({ last5: [fixture(2, 1, 0), fixture(0, 0, 1), fixture(3, 2, 2), fixture(1, 0, 3), fixture(4, 4, 4)] });
const rates = recentGoalRates(five);
eq("recent rates: BTTS counted only when both sides scored", rates.btts, { pct: 60, sample: 5 });
eq("recent rates: over 2.5 counted on total goals", rates.over25, { pct: 60, sample: 5 });
eq("recent rates: average total goals", rates.avgTotalGoals, 3.4);

eq("recent rates: below the sample floor everything is withheld", recentGoalRates(digest({ last5: [fixture(1, 1, 0)] })).btts, null);
eq("recent rates: empty last5 is withheld, not 0%", recentGoalRates(digest()).btts, null);

// A fixture with no scoreline must be excluded, not counted 0-0 — which would
// drag BTTS and over-2.5 down with a match nobody has figures for.
const withUnknown = digest({ last5: [fixture(2, 1, 0), fixture(null, null, 1), fixture(3, 2, 2), fixture(1, 1, 3), fixture(2, 2, 4)] });
eq("recent rates: unscored fixtures excluded from the sample", recentGoalRates(withUnknown).btts, null);

// --- Combined rate / emptiness -------------------------------------------
const facts = buildMatchFacts(homeSide, homeSide);
eq("match facts: combined rate adds home-scoring and away-scoring", facts.combinedGoalRate, Number((2.9 + 2.7).toFixed(2)));
eq("match facts: combined rate needs BOTH sides", buildMatchFacts(homeSide, null).combinedGoalRate, null);
check("match facts: fully empty pair reports empty", isMatchFactsEmpty(buildMatchFacts(null, null)));
check("match facts: a populated pair does not report empty", !isMatchFactsEmpty(facts));

// --- Availability freshness ----------------------------------------------
eq("freshness: no digest is UNAVAILABLE", availabilityFreshness(null, NOW).state, "unavailable");
eq("freshness: no asOf is UNAVAILABLE (feed never resolved)", availabilityFreshness(digest(), NOW).state, "unavailable");
eq("freshness: today is current", availabilityFreshness(digest({ availabilityAsOf: "2026-08-18" }), NOW).state, "current");
eq("freshness: exactly at the threshold is still current",
  availabilityFreshness(digest({ availabilityAsOf: "2026-08-15" }), NOW).state, "current");

const stale = availabilityFreshness(digest({ availabilityAsOf: "2026-08-14" }), NOW);
eq("freshness: past the threshold is stale", stale.state, "stale");
eq("freshness: stale reports the age in days", stale.state === "stale" ? stale.ageDays : null, 4);
eq("freshness: stale reports the date it was read", stale.state === "stale" ? stale.asOf : null, "2026-08-14");
eq("freshness: malformed asOf is UNAVAILABLE, not current",
  availabilityFreshness(digest({ availabilityAsOf: "not-a-date" }), NOW).state, "unavailable");

// --- The four team-news states -------------------------------------------
// The pair that must never merge: no feed vs feed-says-nobody-out.
eq("team news: no feed is 'unavailable'", teamNewsState(digest(), NOW).kind, "unavailable");
eq("team news: no feed is NOT 'none-reported'", teamNewsState(digest(), NOW).kind === "none-reported", false);
eq("team news: resolved-but-empty is 'none-reported'",
  teamNewsState(digest({ availabilityAsOf: "2026-08-17", availability: [] }), NOW).kind, "none-reported");

const absences: AvailabilityEntry[] = [
  { player: "A. Injured", reason: "Knee Injury", kind: "injury" },
  { player: "B. Banned", reason: "Yellow Cards", kind: "suspension" },
  { player: "C. Benched", reason: "Inactive", kind: "unavailable" },
];
const withAbsences = teamNewsState(digest({ availabilityAsOf: "2026-08-17", availability: absences }), NOW);
eq("team news: absences reported as 'absences'", withAbsences.kind, "absences");
if (withAbsences.kind === "absences") {
  eq("team news: injuries bucketed separately", withAbsences.injuries.map((e) => e.player), ["A. Injured"]);
  eq("team news: suspensions kept distinct from injuries", withAbsences.suspensions.map((e) => e.player), ["B. Banned"]);
  eq("team news: not-selected kept distinct from injuries", withAbsences.other.map((e) => e.player), ["C. Benched"]);
  eq("team news: carries freshness", withAbsences.freshness.state, "current");
}

// A stale list must stay reportable AND carry its staleness, not be suppressed.
const staleAbsences = teamNewsState(digest({ availabilityAsOf: "2026-08-01", availability: absences }), NOW);
eq("team news: stale absences still reported", staleAbsences.kind, "absences");
eq("team news: stale absences carry the stale flag",
  staleAbsences.kind === "absences" ? staleAbsences.freshness.state : null, "stale");

// --- Verdict --------------------------------------------------------------
eq("confidence band: top of range", confidenceBand(85), "Strong");
eq("confidence band: boundary at 75", confidenceBand(75), "Strong");
eq("confidence band: boundary at 60", confidenceBand(60), "Solid");
eq("confidence band: boundary at 45", confidenceBand(45), "Moderate");
eq("confidence band: below 45", confidenceBand(44), "Tentative");

const v = verdictLine({ market: "Match Winner", pick: "Arsenal", confidence: 72, overUnder: "Over 2.5 Goals" });
check("verdict: names the pick", v.includes("Arsenal"), v);
check("verdict: states the confidence figure", v.includes("72%"), v);
check("verdict: includes the secondary total-goals call", v.includes("Over 2.5 Goals"), v);
check("verdict: omits totals when absent", !verdictLine({ market: "M", pick: "P", confidence: 50 }).includes("Total goals"));

// --- Stored analysis ------------------------------------------------------
eq("analysis: builds from model output", buildAnalysis({ keyFactors: ["a", "b"] }).keyFactors, ["a", "b"]);
eq("analysis: drops non-strings", buildAnalysis({ keyFactors: ["a", 5, null] as unknown as string[] }).keyFactors, ["a"]);
eq("analysis: drops blanks", buildAnalysis({ keyFactors: ["a", "   "] }).keyFactors, ["a"]);
eq("analysis: caps the list", buildAnalysis({ keyFactors: Array(20).fill("x") }).keyFactors.length, 6);
eq("analysis: drops paragraph-length entries", buildAnalysis({ keyFactors: ["ok", "x".repeat(300)] }).keyFactors, ["ok"]);
eq("analysis: missing field yields an empty list", buildAnalysis({}).keyFactors, []);

eq("analysis: round-trips", parseAnalysis(JSON.parse(JSON.stringify(buildAnalysis({ keyFactors: ["a"] }))))?.keyFactors, ["a"]);
eq("analysis: null is rejected", parseAnalysis(null), null);
eq("analysis: unknown version rejected", parseAnalysis({ v: 9, keyFactors: ["a"] }), null);
eq("analysis: empty factor list reads as nothing to render", parseAnalysis({ v: 1, keyFactors: [] }), null);
eq("analysis: an all-blank list reads as nothing to render", parseAnalysis({ v: 1, keyFactors: ["  "] }), null);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("All match-facts checks passed.");
