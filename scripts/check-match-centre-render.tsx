/**
 * Sprint 02 Match Centre — rendered-HTML checks, no browser, no database.
 *
 * Renders the new and extended match-page panels to static markup against
 * full, sparse and hostile data and asserts what a reader (and a screen
 * reader) would get: real numbers with their samples, honest empty states,
 * correct match states, nothing premium leaking, and the page wiring.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-match-centre-render.tsx
 */
import React from "react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { FormGoalsBody } from "../src/components/matchcentre/FormGoalsBody";
import { MatchFormGoals } from "../src/components/matchcentre/MatchFormGoals";
import { H2HBody } from "../src/components/matchcentre/H2HBody";
import { MatchResultPanel } from "../src/components/matchcentre/MatchResultPanel";
import { MatchStandingsContext } from "../src/components/MatchStandingsContext";
import { MatchH2HSummary } from "../src/components/MatchH2HSummary";
import { MatchScoreClock } from "../src/components/MatchScoreClock";
import { compactFixtureResult, formSource, h2hWindow } from "../src/lib/matchCentre";
import type { InsightFixture } from "../src/lib/insights";
import type { H2HMeeting } from "../src/lib/h2h";
import type { LeagueStandingRow } from "../src/lib/enrichment";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail.slice(0, 220)}` : ""}`);
}
const html = (el: React.ReactElement | null) => (el ? renderToStaticMarkup(el) : "");
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");

const HOME = 10, AWAY = 20;
const KICKOFF = new Date("2026-11-14T15:00:00Z");
let id = 5000;
const fx = (date: string, h: number, a: number, hg: number | null, ag: number | null, extra: Partial<InsightFixture> = {}): InsightFixture => ({ id: id++, date, status: "FT", leagueId: 39, leagueName: "Premier League", homeId: h, homeName: `Team ${h}`, awayId: a, awayName: `Team ${a}`, home: hg, away: ag, ...extra });
const homeHistory = [
  fx("2026-11-08T15:00:00Z", HOME, 1, 2, 0),
  fx("2026-11-01T15:00:00Z", 2, HOME, 1, 1),
  fx("2026-10-25T15:00:00Z", HOME, 3, 3, 2),
  fx("2026-10-18T15:00:00Z", 4, HOME, 0, 1, { leagueId: 48, leagueName: "EFL Cup" }),
];
const awayHistory = [fx("2026-11-07T15:00:00Z", 5, AWAY, 2, 2)];
const source = formSource({ homeHistory, awayHistory, homeTeamApiId: HOME, awayTeamApiId: AWAY, homeTeam: "Home FC", awayTeam: "Away United", kickoff: KICKOFF, leagueApiId: 39, leagueName: "Premier League" });

console.log("form & goals:");
{
  const h = html(<FormGoalsBody source={source} homeTeam="Home FC" awayTeam="Away United" homeTeamApiId={HOME} awayTeamApiId={AWAY} leagueName="Premier League" timeZone="Africa/Lagos" />);
  const t = text(h);
  check("default view: last 5, all competitions", /aria-pressed="true"[^>]*>Last 5</.test(h) && /aria-pressed="true"[^>]*>All</.test(h));
  check("sample sizes stated per team", t.includes("4 matches") && t.includes("1 match"));
  check("short sample flagged, never padded", t.includes("Only 1 verified in this scope (window 5)") && (h.match(/title="(Win|Draw|Loss) /g) ?? []).length === 5);
  check("scope stated", t.includes("all competitions"));
  check("rates printed with their basis (n/d) and %", t.includes("3/4") && t.includes("75%"));
  check("averages printed", t.includes("1.75") && t.includes("2.00"));
  check("form tiles have full screen-reader text", h.includes('class="sr-only">Win 2-0 v Team 1'));
  check("source matches listed for traceability", t.includes("Source matches (4)") && t.includes("EFL Cup"));
  check("comparison is a real table with caption and row headers", h.includes("<caption") && h.includes('scope="row"') && h.includes("not predictions"));
  check("bars are decorative only (aria-hidden)", (h.match(/aria-hidden="true" class="mt-0.5 flex h-1 /g) ?? []).length >= 9);
  check("historical framing, no probability claim", t.includes("not a probability"));
  check("toggles are buttons with aria-pressed", (h.match(/aria-pressed=/g) ?? []).length === 5);
  const none = html(<MatchFormGoals source={formSource({ homeHistory: [], awayHistory: null, homeTeamApiId: HOME, awayTeamApiId: AWAY, homeTeam: "A", awayTeam: "B", kickoff: KICKOFF, leagueApiId: 39, leagueName: null })} homeTeam="A" awayTeam="B" homeTeamApiId={HOME} awayTeamApiId={AWAY} leagueName={null} timeZone="Africa/Lagos" />);
  check("no verified history for either team → no panel at all", none === "");
  check("no team ids → no panel", html(<MatchFormGoals source={source} homeTeam="A" awayTeam="B" homeTeamApiId={null} awayTeamApiId={AWAY} leagueName={null} timeZone="Africa/Lagos" />) === "");
  const zoned = html(<FormGoalsBody source={source} homeTeam="Home FC" awayTeam="Away United" homeTeamApiId={HOME} awayTeamApiId={AWAY} leagueName="Premier League" timeZone="Pacific/Auckland" />);
  check("dates follow the reader's timezone (8 Nov 15:00Z is 9 Nov in Auckland)", text(zoned).includes("9 Nov 2026") && text(h).includes("8 Nov 2026"));
}

console.log("head-to-head:");
{
  let mid = 1;
  const m = (date: string, h: number, a: number, hg: number, ag: number): H2HMeeting => ({ fixtureApiId: mid++, date, leagueName: "Premier League", leagueApiId: 39, homeTeamApiId: h, homeTeam: h === HOME ? "Home FC" : "Away United", awayTeamApiId: a, awayTeam: a === HOME ? "Home FC" : "Away United", homeGoals: hg, awayGoals: ag });
  const meetings = [m("2026-03-01T15:00:00Z", HOME, AWAY, 2, 1), m("2025-10-01T15:00:00Z", AWAY, HOME, 1, 1), m("2025-03-01T15:00:00Z", HOME, AWAY, 0, 0)];
  const ten = h2hWindow(meetings, HOME, AWAY, 10, KICKOFF).meetings;
  const t = text(html(<H2HBody meetings={ten} homeTeamApiId={HOME} awayTeamApiId={AWAY} kickoff={KICKOFF.toISOString()} homeTeam="Home FC" awayTeam="Away United" timeZone="Africa/Lagos" />));
  check("sample stated", t.includes("3 meetings"));
  // BTTS: 2-1 and 1-1 → 2 of 3; over 2.5: only the 2-1 → 1 of 3.
  check("BTTS and over 2.5 with counts", t.includes("67% 2 of 3 Both scored") && t.includes("33% 1 of 3 Over 2.5"));
  check("goals per side and per meeting", t.includes("3-2") && t.includes("1.7 per meeting"));
  check("no window toggle when there are only ≤5 meetings", !html(<H2HBody meetings={ten} homeTeamApiId={HOME} awayTeamApiId={AWAY} kickoff={KICKOFF.toISOString()} homeTeam="A" awayTeam="B" timeZone="Africa/Lagos" />).includes("Last 10"));
  check("not presented as a predictor", t.includes("not what will happen"));
  const panel = html(<MatchH2HSummary meetings={meetings} homeTeam="Home FC" awayTeam="Away United" homeTeamApiId={HOME} awayTeamApiId={AWAY} h2hLink={null} kickoff={new Date("2025-01-01T00:00:00Z")} />);
  check("no meeting before kickoff → no panel (finished fixture's own result never counted)", panel === "");
  check("no meetings → no panel", html(<MatchH2HSummary meetings={[]} homeTeam="A" awayTeam="B" homeTeamApiId={HOME} awayTeamApiId={AWAY} h2hLink={null} kickoff={KICKOFF} />) === "");
}

console.log("standings:");
{
  const row = (teamId: number, rank: number, points: number, extra: Partial<LeagueStandingRow> = {}): LeagueStandingRow => ({ rank, teamId, teamName: `Team ${teamId}`, teamLogo: null, points, played: 12, win: 7, draw: 3, loss: 2, goalsFor: 22, goalsAgainst: 11, form: null, ...extra });
  const table = [row(1, 1, 30), row(HOME, 2, 24, { teamName: "Home FC", home: { played: 6, win: 5, draw: 1, loss: 0, goalsFor: 14, goalsAgainst: 3 } }), row(3, 3, 22), row(AWAY, 4, 21, { teamName: "Away United", away: { played: 6, win: 2, draw: 2, loss: 2, goalsFor: 8, goalsAgainst: 8 } })];
  const h = html(<MatchStandingsContext standings={table} homeTeamApiId={HOME} awayTeamApiId={AWAY} leagueName="Premier League" leagueApiId={39} homeTeam="Home FC" awayTeam="Away United" season={2026} />);
  const t = text(h);
  check("points and places sentence", t.includes("Home FC are 3 points and 2 places ahead of Away United."));
  check("season named", t.includes("Premier League 2026/27 table"));
  check("venue records from the table splits", t.includes("Home FC at home") && t.includes("5-1-0") && t.includes("Away United away") && t.includes("2-2-2"));
  check("W/D/L and goals columns present", h.includes(">W</th>") && h.includes(">GF:GA</th>") && t.includes("22:11"));
  check("caption for screen readers", h.includes("<caption"));
  check("team missing from this competition's table → nothing shown", html(<MatchStandingsContext standings={table} homeTeamApiId={HOME} awayTeamApiId={999} leagueName="X" leagueApiId={1} />) === "");
  const grouped = [row(HOME, 1, 9, { teamName: "Home FC" }), row(30, 2, 6), row(AWAY, 1, 7, { teamName: "Away United" }), row(40, 2, 3)];
  const g = text(html(<MatchStandingsContext standings={grouped} homeTeamApiId={HOME} awayTeamApiId={AWAY} leagueName="World Cup" leagueApiId={1} homeTeam="Home FC" awayTeam="Away United" />));
  check("grouped table: titled as groups, only the two teams, no 'places'", g.includes("Group standings") && !g.includes("Team 30") && !g.includes("places"));
}

console.log("result panel and match states:");
{
  const raw = {
    fixture: { id: 777, status: { short: "FT", elapsed: 90 } },
    teams: { home: { id: HOME }, away: { id: AWAY } },
    score: { halftime: { home: 1, away: 0 }, fulltime: { home: 2, away: 1 } },
    events: [
      { time: { elapsed: 12 }, team: { id: HOME }, player: { name: "A. Forward" }, assist: { name: "A. Mid" }, type: "Goal", detail: "Normal Goal" },
      { time: { elapsed: 50 }, team: { id: AWAY }, player: { name: "B. Back" }, type: "Card", detail: "Yellow Card" },
      { time: { elapsed: 77 }, team: { id: AWAY }, player: { name: "B. Striker" }, type: "Goal", detail: "Penalty" },
      { time: { elapsed: 85 }, team: { id: AWAY }, player: { name: "B. Back" }, type: "Card", detail: "Red Card" },
    ],
    statistics: [
      { team: { id: HOME }, statistics: [{ type: "Ball Possession", value: "58%" }, { type: "Total Shots", value: 14 }] },
      { team: { id: AWAY }, statistics: [{ type: "Ball Possession", value: "42%" }, { type: "Total Shots", value: 9 }] },
    ],
  };
  const result = compactFixtureResult(raw, new Date("2026-11-14T17:00:00Z"));
  const base = { homeTeam: "Home FC", awayTeam: "Away United", homeTeamApiId: HOME, timeZone: "Africa/Lagos" };
  const fin = html(<MatchResultPanel {...base} state="finished" result={result} finalScore={{ home: 2, away: 1 }} picks={[{ id: "p1", market: "Match Winner", pick: "Home FC", outcome: "WON" }, { id: "p2", market: "BTTS", pick: "Yes", outcome: "PENDING" }]} lockedCount={2} />);
  const t = text(fin);
  check("final and half-time score", t.includes("Home FC 2 - 1 Away United") && t.includes("Half-time 1-0"));
  check("goals and red cards up front with minutes and names", t.includes("12' Goal, home: A. Forward (assist A. Mid)") && t.includes("77' Penalty, away: B. Striker") && t.includes("85' Red card, away: B. Back"));
  check("bookings and substitutions behind a disclosure", fin.includes("<details") && t.includes("Bookings and substitutions (1)"));
  check("match statistics with real values", t.includes("Ball Possession") && t.includes("58%") && t.includes("14"));
  check("visible picks graded; pending shown as not settled", t.includes("WON") && t.includes("Not settled"));
  check("locked picks counted, never graded", t.includes("2 subscriber picks are not shown"));
  check("capture time stated", t.includes("captured"));
  const noEvents = text(html(<MatchResultPanel {...base} state="finished" result={null} finalScore={{ home: 0, away: 0 }} picks={[]} lockedCount={0} />));
  check("finished without a captured record: score from settlement, events honestly unavailable", noEvents.includes("Home FC 0 - 0 Away United") && noEvents.includes("not available for this match") && !noEvents.includes("Half-time"));
  const pst = text(html(<MatchResultPanel {...base} state="postponed" result={null} finalScore={null} picks={[{ id: "p1", market: "Match Winner", pick: "Home FC", outcome: "PENDING" }]} lockedCount={0} />));
  check("postponed: says so, no score, no events", pst.includes("Postponed") && pst.includes("postponed") && !/\d - \d/.test(pst) && !pst.includes("Half-time"));
  const abd = text(html(<MatchResultPanel {...base} state="abandoned" result={compactFixtureResult({ ...raw, fixture: { id: 777, status: { short: "ABD" } } }, new Date())} finalScore={null} picks={[]} lockedCount={0} />));
  check("abandoned: never shown as a final result", abd.includes("abandoned") && !abd.includes("Full time") && !abd.includes("Home FC 2 - 1"));
  check("scheduled → no result panel", html(<MatchResultPanel {...base} state="scheduled" result={null} finalScore={null} picks={[]} lockedCount={0} />) === "");
  check("live → no result panel (no premature 'result')", html(<MatchResultPanel {...base} state="live" result={result} finalScore={null} picks={[]} lockedCount={0} />) === "");
  check("unknown with nothing settled → no panel", html(<MatchResultPanel {...base} state="unknown" result={null} finalScore={null} picks={[]} lockedCount={0} />) === "");
  const aet = text(html(<MatchResultPanel {...base} state="finished" result={compactFixtureResult({ ...raw, fixture: { id: 777, status: { short: "PEN" } }, score: { ...raw.score, penalty: { home: 4, away: 3 } } }, new Date())} finalScore={{ home: 2, away: 1 }} picks={[]} lockedCount={0} />));
  check("penalties labelled", aet.includes("Penalties 4-3"));

  const clock = text(html(<MatchScoreClock homeTeamApiId={HOME} awayTeamApiId={AWAY} kickoff={new Date(Date.now() + 86_400_000).toISOString()} timeLabel="15:00" dayLabel="SAT 14 NOV" statusCode="PST" />));
  check("postponed fixture labelled on first paint (server status)", clock.includes("Postponed"));
  const clock2 = text(html(<MatchScoreClock homeTeamApiId={HOME} awayTeamApiId={AWAY} kickoff={new Date(Date.now() + 86_400_000).toISOString()} timeLabel="15:00" dayLabel="SAT 14 NOV" />));
  check("no status → plain kickoff, no invented label", clock2.includes("15:00") && !clock2.includes("Postponed"));
}

console.log("page wiring and access:");
{
  const page = src("src/app/(public)/predictions/match/[slug]/page.tsx");
  check("locked rows carry no outcome (result withheld like #173)", (/pick: "LOCKED"[^\n]*outcome: null/.test(page) || /lockedPredictionView\(r\)[^\n]*outcome: null/.test(page)));
  check("result panel gets only picks the reader can see", /picks=\{shaped\.filter\(\(r\) => !\("locked" in r && r\.locked\)\)/.test(page));
  check("no football-API call on the page (caches only)", !/from "@\/lib\/football\/api-football"/.test(page) && !/apiFetch|getFixturesBy/.test(page));
  check("reader timezone from Sprint 01 preferences", /getPersonalization\(session\.user\.id/.test(page) && /kickoffInZone\(match\.kickoff, timeZone\)/.test(page));
  check("follow-competition control (Sprint 01 follows)", /targetType="LEAGUE"/.test(page));
  check("missing sections are named, not silently dropped", /Not available for this match:/.test(page) && /Not shown: \{missing\.join/.test(page));
  check("structured data falls back to the captured status", /statusShort: eventContext\?\.statusShort \?\? result\?\.status/.test(page));
  check("section nav mirrors what renders (H2H/table/result/form-goals conditions)", /hasH2H \? \[\{ id: "h2h"/.test(page) && /hasTable \?/.test(page) && /showResult \?/.test(page) && /hasFormGoals \?/.test(page));
  check("form data passed to the client is public verified matches only (FormSource)", /FormGoalsBody[\s\S]{0,80}source=\{source\}/.test(src("src/components/matchcentre/MatchFormGoals.tsx")));
  const capture = src("src/lib/fixtureResultCapture.ts");
  check("capture is keyed by provider fixture id and never throws", /fixtureApiId: \{ in:/.test(capture) && /catch \(err\)/.test(capture) && /return 0/.test(capture));
  check("capture hooked into settlement, kickoff reconcile and the date slate (no new calls)", /captureFixtureResults\(prefetched\.values\(\)\)/.test(src("src/lib/settleFinished.ts")) && /captureFixtureResults\(prefetched\.values\(\)\)/.test(src("src/lib/kickoffReconcile.ts")) && /captureFixtureResults\(slate\.filter/.test(src("src/lib/enrichment.ts")));
}

console.log("public copy:");
{
  const dir = join(__dirname, "..", "src/components/matchcentre");
  const files = readdirSync(dir).map((f) => `src/components/matchcentre/${f}`).concat(["src/lib/matchCentre.ts", "src/components/MatchStandingsContext.tsx", "src/components/MatchH2HSummary.tsx"]);
  for (const f of files) {
    const t = src(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    check(`${f}: no "AI" wording`, !/\bAI\b|AI-powered|AI-assisted|artificial intelligence/i.test(t));
    check(`${f}: no guarantee language`, !/guarantee|sure win|certain to|lock of the/i.test(t));
    check(`${f}: no accent stripes / tinted pills (CLAUDE.md)`, !/border-[lr]-(2|4|8|brand|emerald|red|amber)/.test(t) && !/rounded-full[^"]*bg-(brand|emerald|red|amber|yellow)-?\d*\/\d+/.test(t));
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
