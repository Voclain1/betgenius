/**
 * Offline self-checks for the Phase 4 SEO and semantics work.
 *
 * No network, no database. What matters here is that the page makes accurate
 * claims about itself:
 *
 *   - the indexability gate scores real evidence, so a substantial page with
 *     one cold cache is still indexable and a thin one is not,
 *   - titles distinguish repeat fixtures by date,
 *   - a gated pick never reaches a meta description,
 *   - structured data asserts only what the page actually holds,
 *   - paragraph splitting doesn't shatter or merge the model's prose.
 *
 * Run: npx tsx scripts/check-seo.ts
 */
import { assessMatchEvidence, EVIDENCE_THRESHOLD, MAX_EVIDENCE_SCORE } from "../src/lib/matchEvidence";
import { matchTitle, matchDescription, titleDate, sportsEventJsonLd, organizationJsonLd, breadcrumbJsonLd } from "../src/lib/seo";
import { toParagraphs, stripInlineMarkers } from "../src/components/Prose";
import { buildAnalysis } from "../src/lib/predictionAnalysis";
import type { TeamDigest } from "../src/lib/ai/digest";
import type { H2HMeeting } from "../src/lib/h2h";
import type { LeagueStandingRow } from "../src/lib/enrichment";

let passed = 0;
const failures: string[] = [];
const check = (l: string, c: boolean, got?: unknown) => {
  if (c) passed++;
  else failures.push(`${l}${got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`}`);
};
const eq = (l: string, a: unknown, b: unknown) => check(l, JSON.stringify(a) === JSON.stringify(b), a);

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

const warmDigest = digest({
  overall: { played: 17, win: 13, draw: 3, loss: 1, goalsFor: 47, goalsAgainst: 23 },
  home: { played: 8, win: 6, draw: 2, loss: 0, goalsFor: 23, goalsAgainst: 11 },
  goalsForAvg: { total: 2.8, home: 2.9, away: 2.7 },
  last5: [1, 2, 3, 4, 5].map((i) => ({ opponent: `O${i}`, venue: "home" as const, result: "W", goalsFor: 2, goalsAgainst: 0, date: `2026-08-0${i}` })),
});

const meetings = (n: number): H2HMeeting[] =>
  Array.from({ length: n }, (_, i) => ({
    fixtureApiId: i, date: `2026-0${i + 1}-01T00:00:00Z`, leagueName: "L", leagueApiId: 1,
    homeTeamApiId: 1, homeTeam: "A", awayTeamApiId: 2, awayTeam: "B", homeGoals: 1, awayGoals: 0,
  }));

const table: LeagueStandingRow[] = [
  { rank: 1, teamId: 1, teamName: "A", teamLogo: null, points: 40, played: 20, win: 12, draw: 4, loss: 4, goalsFor: 30, goalsAgainst: 20, form: null, zone: null },
  { rank: 2, teamId: 2, teamName: "B", teamLogo: null, points: 38, played: 20, win: 11, draw: 5, loss: 4, goalsFor: 28, goalsAgainst: 21, form: null, zone: null },
];

const base = {
  homeDigest: null, awayDigest: null, standings: null,
  homeTeamApiId: 1, awayTeamApiId: 2, h2hMeetings: [] as H2HMeeting[],
  matchPreview: null, analysisJson: null,
};

// --- Evidence model -------------------------------------------------------
const empty = assessMatchEvidence(base);
eq("evidence: an empty page scores zero", empty.score, 0);
check("evidence: an empty page is not substantive", !empty.substantive);
eq("evidence: threshold is exposed for the caller", empty.threshold, EVIDENCE_THRESHOLD);
check("evidence: max score is derived from the weights", MAX_EVIDENCE_SCORE > EVIDENCE_THRESHOLD);

// A warm team cache alone should clear the bar — form, record and venue splits
// IS a substantial page.
const warmOnly = assessMatchEvidence({ ...base, homeDigest: warmDigest });
check("evidence: warm team cache alone is substantive", warmOnly.substantive, warmOnly);
eq("evidence: warm cache lights teamData/recentForm/statistics",
  warmOnly.present.sort(), ["recentForm", "statistics", "teamData"]);

// The path that matters: no digest at all, but real h2h + analysis + table.
const noDigest = assessMatchEvidence({
  ...base,
  h2hMeetings: meetings(6),
  standings: table,
  matchPreview: "x".repeat(400),
});
check("evidence: h2h + analysis + standings is substantive without any digest", noDigest.substantive, noDigest);

// Genuinely thin: a pick, a table row, and "nobody is out".
const thin = assessMatchEvidence({
  ...base,
  standings: table,
  homeDigest: digest({ availabilityAsOf: "2026-08-17", availability: [] }),
  matchPreview: "x".repeat(400),
});
check("evidence: analysis + standings + team news alone is NOT substantive", !thin.substantive, thin);

// One cold cache must not sink a page that has everything else.
const oneCold = assessMatchEvidence({
  ...base, homeDigest: warmDigest, awayDigest: null, standings: table, h2hMeetings: meetings(5), matchPreview: "x".repeat(400),
});
check("evidence: one cold side does not suppress an otherwise full page", oneCold.substantive, oneCold);

// Signal-level correctness.
eq("evidence: 2 meetings is too few for h2h", assessMatchEvidence({ ...base, h2hMeetings: meetings(2) }).signals.headToHead, false);
eq("evidence: 3 meetings counts", assessMatchEvidence({ ...base, h2hMeetings: meetings(3) }).signals.headToHead, true);
eq("evidence: h2h needs both team ids",
  assessMatchEvidence({ ...base, h2hMeetings: meetings(6), homeTeamApiId: null }).signals.headToHead, false);
eq("evidence: an unplayed table row is not standings evidence",
  assessMatchEvidence({ ...base, standings: table.map((r) => ({ ...r, played: 0 })) }).signals.standings, false);
eq("evidence: a stub preview is not analysis", assessMatchEvidence({ ...base, matchPreview: "Too short." }).signals.analysis, false);
eq("evidence: key factors alone count as analysis",
  assessMatchEvidence({ ...base, analysisJson: buildAnalysis({ keyFactors: ["a", "b"] }) }).signals.analysis, true);
eq("evidence: a resolved-but-empty team news feed still counts",
  assessMatchEvidence({ ...base, homeDigest: digest({ availabilityAsOf: "2026-08-17", availability: [] }) }).signals.teamNews, true);
eq("evidence: an unresolved feed does not count",
  assessMatchEvidence({ ...base, homeDigest: digest() }).signals.teamNews, false);

// --- Titles ---------------------------------------------------------------
const t = matchTitle({ homeTeam: "Casa Pia", awayTeam: "Benfica", kickoff: "2026-08-17T16:15:00Z" });
eq("title: reads as one natural phrase", t, "Casa Pia vs Benfica prediction, 17 Aug 2026");
check("title: not keyword-stuffed", !/tips|odds|betting|h2h|preview/i.test(t), t);
eq("title: survives a missing kickoff",
  matchTitle({ homeTeam: "A", awayTeam: "B", kickoff: null }), "A vs B prediction");

// The whole reason the date is there: repeat fixtures must not share a title.
const s1 = matchTitle({ homeTeam: "A", awayTeam: "B", kickoff: "2025-08-17T00:00:00Z" });
const s2 = matchTitle({ homeTeam: "A", awayTeam: "B", kickoff: "2026-08-17T00:00:00Z" });
check("title: repeat fixtures get distinct titles", s1 !== s2, [s1, s2]);

// Day derivation must be UTC, matching the slug's own day.
eq("titleDate: uses UTC, not local time", titleDate("2026-08-17T23:30:00Z"), "17 Aug 2026");
eq("titleDate: rejects a bad date", titleDate("nonsense"), null);

// --- Descriptions ---------------------------------------------------------
const d = matchDescription({
  homeTeam: "Casa Pia", awayTeam: "Benfica", leagueName: "Primeira Liga", kickoff: "2026-08-17T16:15:00Z",
  topPick: { market: "Match Winner", pick: "Benfica to win", confidence: 72 }, marketCount: 3,
});
check("description: leads with the actual call", d.includes("Benfica to win"), d);
check("description: states confidence", d.includes("72%"), d);
check("description: mentions the remaining markets", d.includes("2 more markets"), d);
check("description: includes league and date", d.includes("Primeira Liga") && d.includes("17 Aug 2026"), d);

// The gating case: no publicly visible pick must never leak one.
const gated = matchDescription({
  homeTeam: "A", awayTeam: "B", leagueName: "L", kickoff: "2026-08-17T00:00:00Z", topPick: null, marketCount: 2,
});
check("description: no pick when every row is gated", !/we back/i.test(gated), gated);
check("description: still describes the page usefully", gated.includes("head-to-head"), gated);
check("description: single market does not say 'more markets'",
  !matchDescription({ homeTeam: "A", awayTeam: "B", kickoff: null, topPick: { market: "M", pick: "P", confidence: 50 }, marketCount: 1 }).includes("more market"));

// --- Structured data ------------------------------------------------------
const ld: any = sportsEventJsonLd({
  homeTeam: "Casa Pia", awayTeam: "Benfica", kickoff: "2026-08-17T16:15:00Z", league: "Primeira Liga",
  url: "/predictions/match/x", venue: "Estadio Pina Manique", city: "Lisboa",
  datePublished: "2026-08-16T10:00:00Z", dateModified: "2026-08-17T09:00:00Z",
});
eq("jsonld: is a SportsEvent", ld["@type"], "SportsEvent");
eq("jsonld: carries the venue as a Place", ld.location?.name, "Estadio Pina Manique");
eq("jsonld: carries the city", ld.location?.address?.addressLocality, "Lisboa");
eq("jsonld: carries datePublished", ld.datePublished, "2026-08-16T10:00:00.000Z");
eq("jsonld: carries dateModified", ld.dateModified, "2026-08-17T09:00:00.000Z");
eq("jsonld: absolute url", typeof ld.url === "string" && ld.url.startsWith("http"), true);

// Venue must be omitted, not faked, when the cache has none.
const noVenue: any = sportsEventJsonLd({ homeTeam: "A", awayTeam: "B", kickoff: null, url: "/x" });
check("jsonld: omits location when no venue is cached", !("location" in noVenue), noVenue);
check("jsonld: omits startDate when no kickoff", !("startDate" in noVenue), noVenue);
check("jsonld: omits dates when unknown", !("datePublished" in noVenue) && !("dateModified" in noVenue), noVenue);

// The deliberate absences.
const asString = JSON.stringify([ld, organizationJsonLd(), breadcrumbJsonLd([{ name: "H", path: "/" }])]);
check("jsonld: no FAQPage anywhere", !asString.includes("FAQPage"), asString.slice(0, 120));
check("jsonld: no Article markup anywhere", !/"@type":"(News)?Article"/.test(asString));
eq("jsonld: organization is an Organization", (organizationJsonLd() as any)["@type"], "Organization");

// --- Prose ----------------------------------------------------------------
const twoParas = "Casa Pia host Benfica in the second round.\n\nBenfica were held to a 2-2 draw.";
eq("prose: splits on blank lines", toParagraphs(twoParas).length, 2);
eq("prose: does not split on a single newline", toParagraphs("one\ntwo").length, 1);
eq("prose: joins soft-wrapped lines into one paragraph", toParagraphs("one\ntwo")[0], "one two");
eq("prose: empty input yields nothing", toParagraphs(null), []);

// The Groq fallback emits markdown that the Gemini primary does not, so these
// are live cases now rather than defensive hypotheticals.
const groqStyle = ["**Sirius** are leaders.", "", "## Outlook", "Hacken sit *third*."].join("\n");
eq("prose: a heading after a blank line does not merge two paragraphs", toParagraphs(groqStyle).length, 2);
eq("prose: heading hashes are stripped but their text is kept",
  toParagraphs(groqStyle)[1], "Outlook Hacken sit third.");
check("prose: no raw bold markers survive", !toParagraphs(groqStyle).join(" ").includes("**"));
check("prose: no raw heading markers survive", !toParagraphs(groqStyle).join(" ").includes("#"));
eq("prose: an indented heading is still stripped", stripInlineMarkers("   ### Title"), "Title");
// The bug this guards: \s in the indent class swallowed the preceding newline.
check("prose: stripping a heading preserves the blank line before it",
  stripInlineMarkers(["a.", "", "## B"].join("\n")).includes("\n\n"));
eq("prose: whitespace-only input yields nothing", toParagraphs("   \n\n   "), []);
eq("prose: collapses runs of blank lines", toParagraphs("a\n\n\n\nb").length, 2);

// Markers don't occur in today's output, but must degrade cleanly if they start.
eq("prose: strips bold markers", stripInlineMarkers("**Benfica** are strong"), "Benfica are strong");
eq("prose: strips heading hashes", stripInlineMarkers("## Preview"), "Preview");
eq("prose: strips code ticks", stripInlineMarkers("the `xG` figure"), "the xG figure");
check("prose: leaves ordinary text untouched", stripInlineMarkers("Casa Pia 1-0 Benfica") === "Casa Pia 1-0 Benfica");

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("All SEO and semantics checks passed.");
