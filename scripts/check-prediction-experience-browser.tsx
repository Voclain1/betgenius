/**
 * Sprint 03 — prediction experience: layout measured in a real browser.
 *
 * Same method as check-nav-fit.tsx: compile the real Tailwind CSS, render the
 * changed components to static markup, load that into Chromium at five widths
 * and measure. No server, database or network. What it proves, which markup
 * checks cannot:
 *
 *   - nothing overflows the page sideways at 320, 375, 414, 768 and 1440px,
 *     including the longest status word beside the longest team names;
 *   - touch targets: market chips, the Detailed/Compact toggle and name chips
 *     are at least 36px tall on a phone;
 *   - the desktop kickoff cell is two short lines (it used to wrap to three);
 *   - a kicked-off, awaiting and postponed row are no taller than an upcoming
 *     one by more than a status line, so status never makes a feed bulky.
 *
 * Skips (exit 0) when no browser is installed, unless REQUIRE_BROWSER=1.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-prediction-experience-browser.tsx
 */
import "./lib/reactCacheShim";
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionProvider } from "next-auth/react";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { PredictionsTable, type PredictionTableRow } from "../src/components/PredictionsTable";
import { MarketChips } from "../src/components/MarketChips";
import { PredictionViewSwitch } from "../src/components/PredictionViewSwitch";
import { FollowButton } from "../src/components/FollowButton";
import { MatchScoreClock } from "../src/components/MatchScoreClock";
import { PickList, PickRow } from "../src/components/personal/DashboardParts";
import type { DashboardPick } from "../src/lib/personalizationData";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

function loadBrowser(): { launch: (o: object) => Promise<any> } | null {
  for (const mod of ["playwright", "playwright-core"]) {
    try {
      return require(mod).chromium;
    } catch {
      // try the next one
    }
  }
  return null;
}

const NOW = Date.now();
const MIN = 60_000;
const iso = (ms: number) => new Date(NOW + ms).toISOString();

// The longest names a feed realistically carries, so wrapping is exercised.
const LONG_HOME = "Brighton & Hove Albion";
const LONG_AWAY = "Borussia Mönchengladbach";
const row = (id: string, kickMs: number, extra: Partial<PredictionTableRow> = {}): PredictionTableRow => ({
  id, homeTeam: LONG_HOME, awayTeam: LONG_AWAY, homeTeamApiId: 51, awayTeamApiId: 163, leagueName: "UEFA Champions League", leagueApiId: 2, kickoff: iso(kickMs),
  pick: "Both Teams To Score — Yes", market: "Both Teams to Score", marketType: "BTTS", overUnder: "Over 2.5 Goals", confidence: 71, ...extra,
});
const ROWS = [
  row("upcoming", 30 * 60 * MIN),
  row("started", -40 * MIN),
  row("awaiting", -5 * 60 * MIN),
  row("postponed", -5 * 60 * MIN, { matchStatus: "PST" }),
  row("cancelled", -5 * 60 * MIN, { matchStatus: "CANC" }),
  row("final", -4 * 60 * MIN, { finalHomeScore: 2, finalAwayScore: 1 }),
];
const pick = (id: string, kickMs: number, extra: Partial<DashboardPick> = {}): DashboardPick =>
  ({
    id, category: "TODAY", categories: [{ category: "TODAY" }], marketType: "BTTS", market: "Both Teams to Score", pick: "Yes", odds: 1.72, confidence: 68, outcome: "PENDING",
    leagueApiId: 2, leagueName: "UEFA Champions League", homeTeam: LONG_HOME, awayTeam: LONG_AWAY, homeTeamApiId: 51, awayTeamApiId: 163, fixtureApiId: 1,
    kickoff: new Date(NOW + kickMs), publishedAt: new Date(NOW), finalHomeScore: null, finalAwayScore: null, presented: "TODAY", href: "/x", statusCode: null, ...extra,
  }) as DashboardPick;
const PICKS = [
  pick("a", 30 * 60 * MIN),
  pick("b", -40 * MIN),
  pick("c", -5 * 60 * MIN),
  pick("d", -5 * 60 * MIN, { statusCode: "PST" }),
  pick("e", -4 * 60 * MIN, { finalHomeScore: 2, finalAwayScore: 1, outcome: "WON" }),
];


const MEASURE = `(() => {
  function vis(e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function heights(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)).filter(vis).map(function (e) { return Math.round(e.getBoundingClientRect().height); }); }
  function sectionOverflow(id) {
    var s = document.getElementById(id);
    // Content inside a deliberate sideways scroller (the market-chip strip, the
    // table's own wrapper) may extend past the viewport; the page must not.
    function scrolled(e) { for (var n = e.parentElement; n && n !== s; n = n.parentElement) { var o = getComputedStyle(n).overflowX; if (o === "auto" || o === "scroll") return true; } return false; }
    return Array.prototype.slice.call(s.querySelectorAll("*")).some(function (e) { return vis(e) && !scrolled(e) && e.getBoundingClientRect().right > document.documentElement.clientWidth + 1; });
  }
  var rows = Array.prototype.slice.call(document.querySelectorAll("#table tbody tr")).filter(vis);
  var kick = Array.prototype.slice.call(document.querySelectorAll("#table td time")).filter(vis).map(function (e) { return Math.round(e.getBoundingClientRect().height); });
  return {
    pageScroll: document.documentElement.scrollWidth,
    overflowing: ["chips", "switch", "follow", "clock", "table", "picks"].filter(sectionOverflow),
    chipH: heights("#chips a"),
    switchH: heights("#switch button"),
    followH: heights("#follow a, #follow button"),
    rowH: rows.map(function (r) { return Math.round(r.getBoundingClientRect().height); }),
    kickH: kick,
    pickH: heights("#picks li"),
  };
})()`;

function page(css: string) {
  const markup = renderToStaticMarkup(
    <SessionProvider session={null} refetchOnWindowFocus={false}>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <section id="chips"><MarketChips /></section>
        <section id="switch"><PredictionViewSwitch detailed={<div />} compact={<div />} /></section>
        <section id="follow" className="flex flex-wrap justify-center gap-2">
          <FollowButton targetType="TEAM" targetKey="51" label={LONG_HOME} subject={LONG_HOME} short="" icon={<i className="inline-block h-4 w-4" />} />
          <FollowButton targetType="TEAM" targetKey="163" label={LONG_AWAY} subject={LONG_AWAY} short="" icon={<i className="inline-block h-4 w-4" />} />
          <FollowButton targetType="LEAGUE" targetKey="2" label="UEFA Europa Conference League" subject="UEFA Europa Conference League" short="" icon={<i className="inline-block h-4 w-4" />} />
          <FollowButton targetType="PREDICTION" targetKey="p" label="match" subject="this match" short="match" />
        </section>
        <section id="clock" className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <div className="h-20 w-20 rounded-3xl border" />
          <MatchScoreClock homeTeamApiId={51} awayTeamApiId={163} kickoff={iso(-5 * 60 * MIN)} timeLabel="15:00" timeZoneLabel="WAT" dayLabel="SAT 14 NOV" />
          <div className="h-20 w-20 justify-self-end rounded-3xl border" />
        </section>
        <section id="table"><PredictionsTable rows={ROWS} /></section>
        <section id="picks"><PickList>{PICKS.map((p) => <PickRow key={p.id} row={p} reasons={["team"]} timezone="Africa/Lagos" />)}</PickList></section>
      </main>
    </SessionProvider>,
  );
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body>${markup}</body></html>`;
}

async function main() {
  const chromium = loadBrowser();
  if (!chromium) {
    if (process.env.REQUIRE_BROWSER === "1") {
      console.error("FAIL  no playwright / playwright-core to drive a browser, and REQUIRE_BROWSER=1");
      process.exit(1);
    }
    console.log("SKIP  no playwright / playwright-core installed: the layout cannot be measured here");
    return;
  }
  const root = join(__dirname, "..");
  const config = require(join(root, "tailwind.config.ts"));
  const css = (
    await postcss([tailwindcss({ ...(config.default ?? config), content: [join(root, "src/**/*.{ts,tsx}")] })]).process(readFileSync(join(root, "src/app/globals.css"), "utf8"), { from: join(root, "src/app/globals.css") })
  ).css;
  const html = page(css);

  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    for (const width of [320, 375, 414, 768, 1440]) {
      const p = await browser.newPage({ viewport: { width, height: 900 } });
      await p.route("**/*", (r: any) => r.abort());
      await p.setContent(html);
      // A plain script string: functions serialised by tsx carry a `__name`
      // helper that does not exist inside the page.
      const m = await p.evaluate(MEASURE);
      console.log(`\n${width}px:`);
      check("no horizontal page overflow", m.pageScroll <= width, `scrollWidth ${m.pageScroll}`);
      check("no section overflows the viewport", m.overflowing.length === 0, m.overflowing.join(", "));
      if (width < 768) {
        check("market chips ≥ 36px tall", m.chipH.length > 0 && Math.min(...m.chipH) >= 36, `min ${Math.min(...m.chipH)}`);
        check("Detailed/Compact toggle ≥ 36px tall", m.switchH.length > 0 && Math.min(...m.switchH) >= 36, `min ${Math.min(...m.switchH)}`);
        check("follow chips ≥ 36px tall", m.followH.length > 0 && Math.min(...m.followH) >= 36, `min ${Math.min(...m.followH)}`);
        const base = m.rowH[0];
        check("status rows are not bulkier than an upcoming row by more than one status line", m.rowH.every((h: number) => h - base <= 26), `rows ${m.rowH.join("/")}`);
        check("dashboard rows stay compact with a status line", Math.max(...m.pickH) <= 170, `max ${Math.max(...m.pickH)}`);
      } else {
        check("desktop kickoff is two short lines (≤ 34px), not a three-line wrap", m.kickH.length > 0 && Math.max(...m.kickH) <= 34, `max ${Math.max(...m.kickH)}`);
        // Master measured 104px here at 768px with the same long names and no
        // status; a status line may add one text line, not more.
        check("table rows stay compact (≤ 130px) with the longest names", Math.max(...m.rowH) <= 130, `max ${Math.max(...m.rowH)}`);
      }
      await p.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nThe changed components fit at every width");
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
