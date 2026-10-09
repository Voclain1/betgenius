/**
 * League, cup and team prediction lists: upcoming first, played matches
 * behind a "Hide past" band, each paged.
 *
 * Renders PredictionTimelineList to static markup (no browser, database or
 * running app) and asserts the split, the order, the paging and that the
 * stored "hide past" preference reads, writes and fails safe.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-prediction-timeline.tsx
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "./lib/reactCacheShim";
import { PredictionTimelineList } from "../src/components/PredictionTimelineList";
import {
  HIDE_PAST_KEY,
  PREDICTION_PAGE_SIZE,
  pages,
  readHidePast,
  splitByKickoff,
  writeHidePast,
} from "../src/lib/predictionTimeline";

let passed = 0;
const failures: string[] = [];
const check = (l: string, c: boolean, got?: unknown) => {
  if (c) passed++;
  else failures.push(`${l}${got === undefined ? "" : `\n      got: ${JSON.stringify(String(got).slice(0, 300))}`}`);
};
const count = (s: string, needle: RegExp) => (s.match(needle) ?? []).length;

const NOW = new Date("2026-10-09T12:00:00Z");
const HOUR = 3600_000;
const at = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * HOUR).toISOString();

function row(i: number, kickoff: string | null) {
  return {
    id: `p${i}`, category: "GENIUS", market: "Match Winner", pick: `Pick-${i}`, confidence: 70,
    reasoning: "Because.", leagueName: "Premier League", leagueApiId: 39,
    homeTeam: `Home${i}Side`, awayTeam: `Away${i}Side`, kickoff,
  };
}
const plain = (s: string) => s.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");
const ids = (rs: { id: string }[]) => rs.map((r) => r.id).join(",");
const order = (s: string) => [...s.matchAll(/Home(\d+)Side/g)].map((m) => Number(m[1])).filter((v, i, a) => a.indexOf(v) === i);

// --- split -----------------------------------------------------------------
{
  const rs = [row(1, at(48)), row(2, at(-30)), row(3, at(2)), row(4, at(-1)), row(5, at(-3)), row(6, null)];
  const { upcoming, past } = splitByKickoff(rs, NOW);
  check("upcoming: future and in-play (kicked off under 2h ago), soonest first", ids(upcoming) === "p4,p3,p1", ids(upcoming));
  check("past: played, latest first; no kickoff counts as played", ids(past) === "p5,p2,p6", ids(past));
}

// --- paging ----------------------------------------------------------------
check("page size is 20", PREDICTION_PAGE_SIZE === 20);
check("pages of 20", pages(Array.from({ length: 45 }, (_, i) => i)).map((p) => p.length).join(",") === "20,20,5");
check("no pages for no rows", pages([]).length === 0);

// --- render ----------------------------------------------------------------
const many = [
  ...Array.from({ length: 25 }, (_, i) => row(i, at(24 + i))), // upcoming 0..24
  ...Array.from({ length: 30 }, (_, i) => row(100 + i, at(-24 - i))), // played 100..129
];
for (const view of ["detailed", "compact"] as const) {
  const out = renderToStaticMarkup(<PredictionTimelineList rows={many as any} view={view} emptyUpcoming="None yet." now={NOW} />);
  const seen = order(out);
  const up = seen.filter((n) => n < 100);
  const past = seen.filter((n) => n >= 100);
  check(`${view}: first 20 upcoming shown, soonest first`, up.length === 20 && up[0] === 0 && up[19] === 19, up);
  check(`${view}: first 20 played shown, latest first`, past.length === 20 && past[0] === 100 && past[19] === 119, past);
  check(`${view}: upcoming before played`, seen.indexOf(19) < seen.indexOf(100));
  check(`${view}: show-more buttons say what is left`, plain(out).includes("Show 5 more · 5 left") && plain(out).includes("Show 10 more · 10 left"), plain(out).match(/Show \d+ more[^A-Z]*/g));
  check(`${view}: the played band and its Hide button sit between the groups`, out.indexOf("Played matches") > out.indexOf("Home19Side") && out.indexOf("Played matches") < out.indexOf("Home100Side") && out.includes("Hide past"));
  check(`${view}: counts`, plain(out).includes("30 predictions on matches already played"));
  if (view === "detailed") check("detailed renders cards", count(out, /<article\b/g) === 40);
  if (view === "compact") check("compact renders a table per page", count(out, /<table\b/g) === 2);
}
{
  const out = renderToStaticMarkup(<PredictionTimelineList rows={[row(1, at(-48))] as any} view="detailed" emptyUpcoming="No upcoming picks yet." now={NOW} />);
  check("no upcoming picks: the empty line, then the played band", out.includes("No upcoming picks yet.") && out.includes("Played matches") && !out.includes("more"));
}
{
  const out = renderToStaticMarkup(<PredictionTimelineList rows={[row(1, at(48))] as any} view="detailed" emptyUpcoming="x" now={NOW} />);
  check("nothing played: no band", !out.includes("Played matches") && !out.includes("Hide past"));
}

// --- stored preference -----------------------------------------------------
{
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  check("nothing stored: show played", readHidePast(store) === false);
  writeHidePast(store, true);
  check("hide is remembered", readHidePast(store) === true && mem.get(HIDE_PAST_KEY) === "1");
  writeHidePast(store, false);
  check("show is remembered", readHidePast(store) === false);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  check("a throwing store reads as show", readHidePast(broken as any) === false);
  let threw = false;
  try { writeHidePast(broken as any, true); } catch { threw = true; }
  check("a throwing store never throws on write", !threw);
  check("no store at all", readHidePast(null) === false);
}

if (failures.length) {
  console.error(`check-prediction-timeline: ${failures.length} failure(s)\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`check-prediction-timeline: ${passed} checks passed`);
