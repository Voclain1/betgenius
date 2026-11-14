/**
 * Sprint 03 — prediction experience: rendered-HTML checks, no browser, no
 * database. Renders the changed components to static markup in every state
 * that matters (upcoming, kicked off, awaiting a result, settled, postponed,
 * cancelled, locked, missing data) and asserts what a reader — and a screen
 * reader — would get, including that nothing restricted appears.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-prediction-experience-render.tsx
 */
import "./lib/reactCacheShim";
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionProvider } from "next-auth/react";
import { ScoreCell } from "../src/components/LiveScores";
import { PredictionsTable, type PredictionTableRow } from "../src/components/PredictionsTable";
import { MatchScoreClock } from "../src/components/MatchScoreClock";
import { MarketChips } from "../src/components/MarketChips";
import { FollowButton } from "../src/components/FollowButton";
import { PickRow, SavedRow } from "../src/components/personal/DashboardParts";
import type { DashboardPick, SavedItem } from "../src/lib/personalizationData";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail.slice(0, 240)}` : ""}`);
}
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
const count = (h: string, needle: string) => h.split(needle).length - 1;

const NOW = Date.now();
const MIN = 60_000;
const at = (ms: number) => new Date(NOW + ms);
const iso = (ms: number) => at(ms).toISOString();

console.log("ScoreCell:");
{
  const base = { homeTeamApiId: 42, awayTeamApiId: 49 } as const;
  const cell = (props: Record<string, unknown>) => html(<ScoreCell {...base} hideWhenEmpty align="right" size="lg" {...props} />);
  check("upcoming: renders nothing (unchanged)", cell({ kickoff: iso(30 * 60 * MIN) }) === "");
  check("upcoming without hideWhenEmpty: still the dash", html(<ScoreCell {...base} kickoff={iso(30 * 60 * MIN)} />).includes("—"));
  check("kicked off 40 min ago: says so, never 'live'", text(cell({ kickoff: iso(-40 * MIN) })) === "Kicked off");
  check("kicked off 5 h ago, no score: awaiting result", text(cell({ kickoff: iso(-5 * 60 * MIN) })) === "Awaiting result");
  const pst = cell({ kickoff: iso(-5 * 60 * MIN), statusCode: "PST" });
  check("postponed: says so, in the warning tone", text(pst) === "Postponed" && pst.includes("text-amber-400"));
  check("cancelled", text(cell({ kickoff: iso(-5 * 60 * MIN), statusCode: "CANC" })) === "Cancelled");
  check("postponed before kickoff (original time still ahead)", text(cell({ kickoff: iso(48 * 60 * MIN), statusCode: "PST" })) === "Postponed");
  const fin = cell({ kickoff: iso(-5 * 60 * MIN), finalHomeScore: 2, finalAwayScore: 1 });
  check("stored final score: FT and score, unchanged", text(fin).includes("FT") && text(fin).includes("2") && text(fin).includes("1") && !text(fin).includes("Awaiting"));
  check("0-0 stored: still a score", text(cell({ kickoff: iso(-5 * 60 * MIN), finalHomeScore: 0, finalAwayScore: 0 })).includes("FT"));
  check("a stored score beats a stale cached live code", !text(cell({ kickoff: iso(-5 * 60 * MIN), finalHomeScore: 1, finalAwayScore: 0, statusCode: "2H" })).includes("Kicked"));
  check("a cached live code is not believed", text(cell({ kickoff: iso(-5 * 60 * MIN), statusCode: "2H" })) === "Awaiting result");
  check("no kickoff: no claim", cell({ kickoff: null }) === "");
  check("status wraps (card) rather than overflowing", cell({ kickoff: iso(-5 * 60 * MIN) }).includes("max-w-[6.5rem]"));
}

console.log("PredictionsTable:");
{
  const mk = (id: string, home: string, kickMs: number, extra: Partial<PredictionTableRow> = {}): PredictionTableRow => ({
    id, homeTeam: home, awayTeam: "Opponent FC", homeTeamApiId: 1000 + id.length, awayTeamApiId: 2000, leagueName: "Premier League", leagueApiId: 39,
    kickoff: iso(kickMs), pick: "Yes", market: "Both Teams to Score", marketType: "BTTS", overUnder: "Over 2.5 Goals", confidence: 71, ...extra,
  });
  const rows = [
    // Team names are deliberately neutral: they must not contain a status word.
    mk("up", "Northgate", 30 * 60 * MIN),
    mk("started", "Eastbridge", -40 * MIN),
    mk("awaiting", "Southfield", -5 * 60 * MIN),
    mk("postponed", "Westmere", -5 * 60 * MIN, { matchStatus: "PST" }),
    mk("final", "Highbury Town", -4 * 60 * MIN, { finalHomeScore: 2, finalAwayScore: 1 }),
    mk("locked", "Lowfield", 3 * 60 * MIN, { locked: true, pick: "LOCKED", confidence: null, overUnder: null }),
  ];
  const h = html(<PredictionsTable rows={rows} />);
  const t = text(h);
  check("exactly one 'Kicked off' (only the row that has)", count(t, "Kicked off") === 1, `${count(t, "Kicked off")}`);
  check("awaiting and postponed each appear once", count(t, "Awaiting result") === 1 && count(t, "Postponed") === 1);
  check("the settled row still shows FT", /FT/.test(t));
  check("upcoming rows carry no status word", !/Kicked off|Awaiting|Postponed/.test(text(html(<PredictionsTable rows={[rows[0]]} />))));
  check("kickoff is machine-readable (<time datetime>) in both layouts", (h.match(/<time dateTime="|<time datetime="/gi) ?? []).length >= rows.length * 2);
  const first = new Date(rows[0].kickoff as string);
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" }).format(first);
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Lagos" }).format(first);
  check("desktop kickoff: time and zone first, then the full date", h.includes(`${clock} <span class="text-[11px] font-semibold text-gray-500">WAT</span></span><span class="block text-[11px] font-semibold text-gray-500">${day}</span>`), `${clock} / ${day}`);
  check("phone line carries the date, not just a weekday", t.includes(`${day} ${clock} WAT`));
  check("bare confidence figure is labelled for screen readers", h.includes('<span class="sr-only">Confidence </span>71%'));
  const lockedHtml = html(<PredictionsTable rows={[rows[5]]} />);
  check("locked row: LOCKED shown, no confidence, no over/under, no save control", text(lockedHtml).includes("LOCKED") && !lockedHtml.includes("sr-only\">Confidence") && !lockedHtml.includes("Over 2.5") && !lockedHtml.includes("Save prediction") && !lockedHtml.includes("Sign in to save"));
  check("locked row's status is still shown (a public fact)", /Kicked off|Awaiting|Postponed/.test(text(html(<PredictionsTable rows={[{ ...rows[5], kickoff: iso(-5 * 60 * MIN), matchStatus: "PST" }]} />))));
  check("missing kickoff renders a dash, not a date", text(html(<PredictionsTable rows={[mk("nokick", "NoKick", 0, { kickoff: null })]} />)).includes("—"));
  const withAd = html(<PredictionsTable rows={rows} ads={[{ after: 2, node: <i>AD</i> }]} />);
  check("an in-feed ad still spans the same 7 columns (colSpan formula intact)", /colSpan="7"/.test(withAd) && text(withAd).includes("AD"));
}

console.log("dashboard rows:");
{
  const pick = (over: Partial<DashboardPick> = {}): DashboardPick =>
    ({
      id: "p1", category: "TODAY", categories: [{ category: "TODAY" }], marketType: "BTTS", market: "Both Teams to Score", pick: "Yes", odds: null, confidence: 68,
      outcome: "PENDING", leagueApiId: 39, leagueName: "Premier League", homeTeam: "Arsenal", awayTeam: "Chelsea", homeTeamApiId: 42, awayTeamApiId: 49, fixtureApiId: 1,
      kickoff: at(5 * 60 * MIN), publishedAt: at(-60 * MIN), finalHomeScore: null, finalAwayScore: null, presented: "TODAY", href: "/predictions/match/arsenal-vs-chelsea-2026-11-14", statusCode: null, ...over,
    }) as DashboardPick;
  const row = (p: DashboardPick, reasons: ("team" | "league" | "market")[] = []) => html(<ul><PickRow row={p} reasons={reasons} timezone="Africa/Lagos" /></ul>);
  const up = row(pick());
  check("upcoming: no status text", !/Kicked off|Awaiting|Postponed|FT/.test(text(up)));
  check("the redundant 'Today' tag is gone", !/Confidence 68%\s*Today/.test(text(up)));
  check("a distinguishing category is kept (Banker)", text(row(pick({ presented: "BANKER" }))).includes("Banker"));
  check("Bet of the Day keeps its own name, distinct from Banker", text(row(pick({ presented: "BET_OF_THE_DAY" }))).includes("Bet of the Day") && !text(row(pick({ presented: "BET_OF_THE_DAY" }))).includes("Banker"));
  const settled = text(row(pick({ kickoff: at(-4 * 60 * MIN), finalHomeScore: 2, finalAwayScore: 1, outcome: "WON" })));
  check("settled: FT score and result", settled.includes("FT 2–1") && settled.includes("WON"));
  check("lost is shown as lost", text(row(pick({ kickoff: at(-4 * 60 * MIN), finalHomeScore: 0, finalAwayScore: 0, outcome: "LOST" }))).includes("LOST"));
  check("kicked off, unsettled", text(row(pick({ kickoff: at(-40 * MIN) }))).includes("Kicked off"));
  check("awaiting a result", text(row(pick({ kickoff: at(-5 * 60 * MIN) }))).includes("Awaiting result"));
  const pst = row(pick({ kickoff: at(-5 * 60 * MIN), statusCode: "PST" }));
  check("postponed: warning tone, no score, no result", text(pst).includes("Postponed") && pst.includes("text-amber-400") && !/FT|WON|LOST/.test(text(pst)));
  check("postponed beats a stray stored score", text(row(pick({ kickoff: at(-5 * 60 * MIN), statusCode: "PST", finalHomeScore: 1, finalAwayScore: 0 }))).includes("Postponed"));
  const odds = text(row(pick({ odds: 1.72 })));
  check("odds are labelled 'Odds', apart from confidence", odds.includes("Confidence 68%") && /Odds\s+(Decimal odds\s+)?1\.72/.test(odds) && !odds.includes("@ 1.72"));
  check("missing odds print nothing (not 0, not a dash)", !text(up).includes("Odds"));
  check("match link intact", up.includes('href="/predictions/match/arsenal-vs-chelsea-2026-11-14"'));
  check("save control present on a visible pick", up.includes("Sign in to save this prediction"));

  const saved = (over: Partial<SavedItem>): SavedItem =>
    ({
      id: "s1", predictionId: "p1", homeTeam: "Arsenal", awayTeam: "Chelsea", homeTeamApiId: 42, awayTeamApiId: 49, leagueApiId: 39, leagueName: "Premier League",
      kickoff: at(24 * 60 * MIN), settledAt: null, savedAt: at(-MIN), category: "TODAY", market: "Both Teams to Score", pick: "Yes", odds: 1.7, confidence: 62,
      href: "/predictions/match/x", view: { state: "unplayed", outcome: null, changedTo: null, finalScore: null, locked: false }, statusCode: "PST", ...over,
    }) as SavedItem;
  const sv = text(html(<ul><SavedRow item={saved({})} timezone="Africa/Lagos" /></ul>));
  check("saved: a postponed pick says Postponed, not 'Awaiting result' or a kickoff time", sv.includes("Postponed") && !sv.includes("Awaiting result"));
  check("saved: cancelled", text(html(<ul><SavedRow item={saved({ statusCode: "CANC" })} timezone="Africa/Lagos" /></ul>)).includes("Cancelled"));
  const lockedSaved = text(html(<ul><SavedRow item={saved({ market: null, pick: null, odds: null, confidence: null, view: { state: "unplayed", outcome: null, changedTo: null, finalScore: null, locked: true } })} timezone="Africa/Lagos" /></ul>));
  check("saved + locked: the status fact shows, the pick does not", lockedSaved.includes("Postponed") && lockedSaved.includes("upgrade to view") && !lockedSaved.includes("Odds"));
  check("saved: odds labelled 'Odds'", text(html(<ul><SavedRow item={saved({ view: { state: "upcoming", outcome: null, changedTo: null, finalScore: null, locked: false }, statusCode: null })} timezone="Africa/Lagos" /></ul>)).match(/Odds\s+(Decimal odds\s+)?1\.70/) !== null);
}

console.log("follow chips (match header):");
{
  const wrap = (el: React.ReactElement) => html(<SessionProvider session={null} refetchOnWindowFocus={false}>{el}</SessionProvider>);
  const team = wrap(<FollowButton targetType="TEAM" targetKey="42" label="Arsenal" subject="Arsenal" short="" icon={<i>crest</i>} />);
  check("a team chip names the team, not just 'Follow'", text(team).includes("Arsenal") && !/\bFollow\b/.test(text(team).replace("Follow Arsenal", "")), text(team));
  check("accessible name unchanged and still contains the visible name", team.includes('aria-label="Follow Arsenal"'));
  const league = wrap(<FollowButton targetType="LEAGUE" targetKey="39" label="Premier League" subject="Premier League" short="" icon={<i>badge</i>} />);
  check("the competition chip names the competition", text(league).includes("Premier League") && league.includes('aria-label="Follow Premier League"'));
  check("a plus glyph marks it as an action", /lucide-plus/.test(team));
  check("long names truncate instead of overflowing", team.includes("truncate"));
  check("the chip is at least 36px tall", /min-h-9/.test(team));
  const legacy = text(wrap(<FollowButton targetType="TEAM" targetKey="42" label="Arsenal" />));
  check("other callers unchanged: bare 'Follow this'", legacy.includes("Follow this"));
  check("'Follow match' chip unchanged", text(wrap(<FollowButton targetType="PREDICTION" targetKey="p1" label="A vs B" subject="this match" short="match" />)).includes("Follow match"));
}

console.log("match header clock:");
{
  const clock = (kick: number, extra: Record<string, unknown> = {}) => text(html(<MatchScoreClock homeTeamApiId={42} awayTeamApiId={49} kickoff={iso(kick)} timeLabel="15:00" dayLabel="SAT 14 NOV" timeZoneLabel="WAT" {...extra} />));
  check("upcoming: only the kickoff time", !/Kicked off|Awaiting|Postponed/.test(clock(24 * 60 * MIN)) && clock(24 * 60 * MIN).includes("15:00"));
  check("started, nothing known: 'Kicked off', kickoff time kept", clock(-40 * MIN).includes("Kicked off") && clock(-40 * MIN).includes("15:00"));
  check("long past, no score: 'Awaiting result'", clock(-5 * 60 * MIN).includes("Awaiting result"));
  check("postponed: says Postponed and never 'Awaiting'", clock(-5 * 60 * MIN, { statusCode: "PST" }).includes("Postponed") && !clock(-5 * 60 * MIN, { statusCode: "PST" }).includes("Awaiting"));
  check("stored final score: FT, no waiting label", !clock(-5 * 60 * MIN, { finalScore: { home: 2, away: 1 } }).includes("Awaiting") && clock(-5 * 60 * MIN, { finalScore: { home: 2, away: 1 } }).includes("Full time"));
}

console.log("touch targets and navigation (markup):");
{
  const chips = html(<MarketChips />);
  check("market chips are ≥ 36px tall on phones", (chips.match(/min-h-9/g) ?? []).length === 4);
  check("view toggle buttons are ≥ 36px tall", /inline-flex min-h-9 items-center gap-1\.5 rounded-full/.test(src("src/components/PredictionViewSwitch.tsx")));
  check("back button is ≥ 40px tall", /min-h-10/.test(src("src/components/BackButton.tsx")));
  check("saved predictions linked from the account menu and the drawer", (src("src/components/Nav.tsx").match(/href="\/dashboard\/saved"/g) ?? []).length === 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
