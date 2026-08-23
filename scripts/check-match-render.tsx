/**
 * Render checks for the match-page panels, against sparse and hostile data.
 *
 * The panels are server components with no client hooks, so they can be
 * rendered to static markup here without a browser, a database or a running
 * app. Two things are being verified:
 *
 *   1. Graceful degradation. Every panel must return NOTHING when it has no
 *      data, rather than an empty card, a heading with nothing under it, or a
 *      row of dashes. A sparse fixture should produce a shorter page, not a
 *      broken one.
 *   2. No misleading output. The team-news panel in particular must never emit
 *      "no reported absences" for a side whose feed never resolved — the
 *      failure this is all guarding against, checked here at the rendered-HTML
 *      level rather than only at the state level.
 *
 * Run with the JSX override the automatic runtime needs:
 *   npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-match-render.tsx
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamNewsPanel } from "../src/components/TeamNewsPanel";
import { MatchStatsComparison } from "../src/components/MatchStatsComparison";
import { MatchStandingsContext } from "../src/components/MatchStandingsContext";
import { MatchH2HSummary } from "../src/components/MatchH2HSummary";
import { MatchVerdict } from "../src/components/MatchVerdict";
import { KeyFactors } from "../src/components/KeyFactors";
import { Prose } from "../src/components/Prose";
import { buildAnalysis } from "../src/lib/predictionAnalysis";
import type { TeamDigest } from "../src/lib/ai/digest";
import type { LeagueStandingRow } from "../src/lib/enrichment";
import type { H2HMeeting } from "../src/lib/h2h";

let passed = 0;
const failures: string[] = [];
const check = (l: string, c: boolean, got?: unknown) => {
  if (c) passed++;
  else failures.push(`${l}${got === undefined ? "" : `\n      got: ${JSON.stringify(String(got).slice(0, 200))}`}`);
};

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

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

// ===========================================================================
// The empty fixture: nothing cached for either side. Every panel must vanish.
// ===========================================================================
check("sparse: team news renders nothing when neither feed resolved",
  html(<TeamNewsPanel homeTeam="A" awayTeam="B" homeDigest={null} awayDigest={null} />) === "");

check("sparse: team news renders nothing when digests exist but carry no feed",
  html(<TeamNewsPanel homeTeam="A" awayTeam="B" homeDigest={digest()} awayDigest={digest()} />) === "");

check("sparse: stats comparison renders nothing with no digests",
  html(<MatchStatsComparison homeTeam="A" awayTeam="B" homeDigest={null} awayDigest={null} />) === "");

check("sparse: stats comparison renders nothing for an unplayed season",
  html(<MatchStatsComparison homeTeam="A" awayTeam="B" homeDigest={digest()} awayDigest={digest()} />) === "");

check("sparse: standings context renders nothing with no table",
  html(<MatchStandingsContext standings={null} homeTeamApiId={1} awayTeamApiId={2} leagueName="L" leagueApiId={39} />) === "");

check("sparse: h2h summary renders nothing with no meetings",
  html(<MatchH2HSummary meetings={[]} homeTeam="A" awayTeam="B" homeTeamApiId={1} awayTeamApiId={2} h2hLink={null} />) === "");

check("sparse: key factors render nothing with no analysis",
  html(<KeyFactors analysisJson={null} />) === "");

check("sparse: key factors render nothing for an empty factor list",
  html(<KeyFactors analysisJson={buildAnalysis({ keyFactors: [] })} />) === "");

// H2H without resolved team ids can't be oriented, so it must not guess.
check("sparse: h2h summary renders nothing without team ids",
  html(
    <MatchH2HSummary
      meetings={[{ fixtureApiId: 1, date: "2026-01-01", leagueName: null, leagueApiId: null, homeTeamApiId: 1, homeTeam: "A", awayTeamApiId: 2, awayTeam: "B", homeGoals: 1, awayGoals: 0 }]}
      homeTeam="A" awayTeam="B" homeTeamApiId={null} awayTeamApiId={null} h2hLink={null}
    />,
  ) === "");

// ===========================================================================
// The dangerous case: one side has a resolved feed, the other has none.
// ===========================================================================
const oneSided = html(
  <TeamNewsPanel
    homeTeam="Home FC"
    awayTeam="Away FC"
    homeDigest={digest({ availabilityAsOf: "2026-08-17", availability: [{ player: "A. Player", reason: "Knee Injury", kind: "injury" }] })}
    awayDigest={digest()}
  />,
);
check("mixed: the resolved side reports its absence", oneSided.includes("A. Player"), oneSided);
check("mixed: the resolved side shows the reported reason", oneSided.includes("Knee Injury"), oneSided);
check("mixed: the unresolved side says team news is UNAVAILABLE", oneSided.includes("Team news unavailable"), oneSided);
check("mixed: the unresolved side does NOT claim no absences", !oneSided.includes("No reported absences"), oneSided);

// Resolved-and-empty is the one case allowed to say nobody is out.
const emptyFeed = html(
  <TeamNewsPanel homeTeam="Home FC" awayTeam="Away FC"
    homeDigest={digest({ availabilityAsOf: "2026-08-17", availability: [] })} awayDigest={digest()} />,
);
check("resolved-empty: says no reported absences", emptyFeed.includes("No reported absences"), emptyFeed);

// Suspensions must not be presented as injuries.
const suspended = html(
  <TeamNewsPanel homeTeam="H" awayTeam="A"
    homeDigest={digest({ availabilityAsOf: "2026-08-17", availability: [{ player: "B. Banned", reason: "Yellow Cards", kind: "suspension" }] })}
    awayDigest={null} />,
);
check("suspension: labelled by its own reason", suspended.includes("Yellow Cards"), suspended);
check("suspension: not labelled as an injury", !/injury/i.test(suspended), suspended);

// Staleness must surface past the threshold and stay silent before it.
const staleHtml = html(
  <TeamNewsPanel homeTeam="H" awayTeam="A"
    homeDigest={digest({ availabilityAsOf: "2020-01-01", availability: [{ player: "X", reason: "Injury", kind: "injury" }] })}
    awayDigest={null} />,
);
check("stale: surfaces a last-updated notice", staleHtml.includes("Team news last updated"), staleHtml);

const freshHtml = html(
  <TeamNewsPanel homeTeam="H" awayTeam="A"
    homeDigest={digest({ availabilityAsOf: new Date().toISOString().slice(0, 10), availability: [{ player: "X", reason: "Injury", kind: "injury" }] })}
    awayDigest={null} />,
);
check("fresh: no last-updated notice", !freshHtml.includes("Team news last updated"), freshHtml);

// ===========================================================================
// Partial data: one side populated, the other not — dashes, never zeroes.
// ===========================================================================
const partial = html(
  <MatchStatsComparison
    homeTeam="Home FC" awayTeam="Away FC"
    homeDigest={digest({
      home: { played: 8, win: 6, draw: 2, loss: 0, goalsFor: 23, goalsAgainst: 11 },
      goalsForAvg: { total: 2.8, home: 2.9, away: null },
      cleanSheets: { total: 5, home: 2, away: null },
    })}
    awayDigest={null}
  />,
);
check("partial: the populated side shows its figures", partial.includes("2.9"), partial);
check("partial: the missing side renders an em dash, not a zero", partial.includes("—"), partial);
check("partial: no fabricated 0% for the missing side", !partial.includes("0%"), partial);

// ===========================================================================
// Standings: a team that hasn't played gets no window.
// ===========================================================================
const table: LeagueStandingRow[] = Array.from({ length: 20 }, (_, i) => ({
  rank: i + 1, teamId: 100 + i, teamName: `Team${i + 1}`, teamLogo: null,
  points: 40 - i * 2, played: 20, win: 10, draw: 5, loss: 5, goalsFor: 30, goalsAgainst: 25,
  form: null, zone: i >= 17 ? "Relegation" : null,
}));

const withWindow = html(<MatchStandingsContext standings={table} homeTeamApiId={103} awayTeamApiId={117} leagueName="L" leagueApiId={39} />);
check("standings: renders the fixture teams", withWindow.includes("Team4") && withWindow.includes("Team18"), withWindow);
check("standings: carries the zone label", withWindow.includes("Relegation"), withWindow);
check("standings: omits teams outside both windows", !withWindow.includes("Team10"), withWindow);

const unplayed = table.map((r) => ({ ...r, played: 0, points: 0 }));
check("standings: renders nothing when neither side has played",
  html(<MatchStandingsContext standings={unplayed} homeTeamApiId={103} awayTeamApiId={117} leagueName="L" leagueApiId={39} />) === "");

// ===========================================================================
// Verdict and key factors render their content.
// ===========================================================================
const verdict = html(<MatchVerdict market="Match Winner" pick="Arsenal" confidence={72} overUnder="Over 2.5 Goals" />);
check("verdict: shows the pick", verdict.includes("Arsenal"), verdict);
check("verdict: shows the confidence", verdict.includes("72"), verdict);
check("verdict: shows the band", verdict.includes("Solid"), verdict);
check("verdict: handles missing over/under", html(<MatchVerdict market="M" pick="P" confidence={50} overUnder={null} />).includes("—"));

const kf = html(<KeyFactors analysisJson={buildAnalysis({ keyFactors: ["Home side unbeaten at home", "Away side missing top scorer"] })} />);
check("key factors: renders each bullet", kf.includes("Home side unbeaten at home") && kf.includes("Away side missing top scorer"), kf);

const h2h: H2HMeeting[] = [
  { fixtureApiId: 1, date: "2026-04-27T00:00:00Z", leagueName: "L", leagueApiId: 1, homeTeamApiId: 2, homeTeam: "B", awayTeamApiId: 1, awayTeam: "A", homeGoals: 2, awayGoals: 2 },
  { fixtureApiId: 2, date: "2025-09-14T00:00:00Z", leagueName: "L", leagueApiId: 1, homeTeamApiId: 1, homeTeam: "A", awayTeamApiId: 2, awayTeam: "B", homeGoals: 1, awayGoals: 0 },
];
const h2hHtml = html(<MatchH2HSummary meetings={h2h} homeTeam="A" awayTeam="B" homeTeamApiId={1} awayTeamApiId={2} h2hLink="/predictions/h2h/a-b" />);
check("h2h: shows the scorelines", h2hHtml.includes("2-2") && h2hHtml.includes("1-0"), h2hHtml);
check("h2h: links to the full record", h2hHtml.includes("/predictions/h2h/a-b"), h2hHtml);

// ===========================================================================
// Heading semantics. Every panel heading must be an <h2> carrying the SAME
// visual weight — the match page previously mixed text-sm and text-xl across
// sibling h2s, so the rendered hierarchy contradicted the document outline.
// ===========================================================================
const panels: Array<[string, string]> = [
  ["team news", html(<TeamNewsPanel homeTeam="H" awayTeam="A" homeDigest={digest({ availabilityAsOf: "2026-08-17", availability: [] })} awayDigest={null} />)],
  ["stats", html(<MatchStatsComparison homeTeam="H" awayTeam="A" homeDigest={digest({ home: { played: 8, win: 6, draw: 2, loss: 0, goalsFor: 23, goalsAgainst: 11 } })} awayDigest={null} />)],
  ["standings", html(<MatchStandingsContext standings={table} homeTeamApiId={103} awayTeamApiId={117} leagueName="L" leagueApiId={39} />)],
  ["h2h", html(<MatchH2HSummary meetings={h2h} homeTeam="A" awayTeam="B" homeTeamApiId={1} awayTeamApiId={2} h2hLink={null} />)],
  ["verdict", html(<MatchVerdict market="M" pick="P" confidence={60} overUnder={null} />)],
  ["key factors", html(<KeyFactors analysisJson={buildAnalysis({ keyFactors: ["a"] })} />)],
];
for (const [name, markup] of panels) {
  check(`headings: ${name} uses an h2 section heading`, markup.includes('<h2 class="section-heading">'), markup.slice(0, 140));
  check(`headings: ${name} emits no h1`, !markup.includes("<h1"));
}

// Per-team subheadings inside a panel must be h3, not h2 — they are children of
// the panel's own heading, not siblings of it.
const newsMarkup = html(
  <TeamNewsPanel
    homeTeam="Home FC" awayTeam="Away FC"
    homeDigest={digest({ availabilityAsOf: "2026-08-17", availability: [] })}
    awayDigest={digest({ availabilityAsOf: "2026-08-17", availability: [] })}
  />,
);
check("headings: per-team subheadings are h3", /<h3[^>]*>Home FC<\/h3>/.test(newsMarkup), newsMarkup.slice(0, 220));

// ===========================================================================
// Prose renders real paragraphs, not one pre-wrapped blob.
// ===========================================================================
const proseHtml = html(<Prose text={"First paragraph here.\n\nSecond paragraph here."} />);
check("prose: emits two <p> elements", (proseHtml.match(/<p /g) ?? []).length === 2, proseHtml);
check("prose: no whitespace-pre-wrap blob", !proseHtml.includes("whitespace-pre-wrap"), proseHtml);
check("prose: renders nothing for empty text", html(<Prose text={null} />) === "");

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("All match-page render checks passed.");
