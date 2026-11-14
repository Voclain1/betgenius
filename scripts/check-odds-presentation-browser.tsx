/**
 * Sprint 05 — odds fit and stay readable on a phone (component-level, Chromium).
 *
 * Same method as check-nav-fit.tsx: compile the real Tailwind CSS, render the
 * changed odds surfaces to static markup, load them in Chromium at 320, 375,
 * 414, 768 and 1440px and measure. Uses the widest realistic prices (250.00 a
 * leg, a product of four legs that is ten digits wide) and the longest team names so wrapping is exercised.
 *
 *   - nothing overflows the page sideways;
 *   - no price is clipped by its own box;
 *   - the price text is at least 11px (the smallest the site uses for data);
 *   - screen-reader text exists beside every price and is visually hidden;
 *   - the phrase "when saved" and the quote labels are present, not truncated.
 *
 * Skips (exit 0) with no browser, unless REQUIRE_BROWSER=1.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-odds-presentation-browser.tsx
 */
import "./lib/reactCacheShim";
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { PredictionCard } from "../src/components/PredictionCard";
import { ComboCard } from "../src/components/ComboCard";
import { TrendCard } from "../src/components/TrendCard";
import { BetOfTheDayCard } from "../src/components/BetOfTheDayCard";
import { PickRow, PickList, SavedRow } from "../src/components/personal/DashboardParts";

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
      /* try the next */
    }
  }
  return null;
}

const LONG_H = "Brighton & Hove Albion";
const LONG_A = "Borussia Mönchengladbach";
const kick = new Date(Date.now() + 30 * 3_600_000);
const pick = { id: "a", category: "TODAY", categories: [], marketType: "BTTS", market: "Both Teams to Score", pick: "Yes", odds: 250, confidence: 68, outcome: "PENDING", leagueApiId: 2, leagueName: "UEFA Champions League", homeTeam: LONG_H, awayTeam: LONG_A, homeTeamApiId: 51, awayTeamApiId: 163, fixtureApiId: 1, kickoff: kick, publishedAt: new Date(), finalHomeScore: null, finalAwayScore: null, presented: "BANKER", href: "/x", statusCode: null } as any;
const saved = { id: "s", predictionId: "p", homeTeam: LONG_H, awayTeam: LONG_A, homeTeamApiId: 51, awayTeamApiId: 163, leagueApiId: 2, leagueName: "UEFA Champions League", kickoff: kick, settledAt: null, savedAt: new Date(), category: "TODAY", market: "Both Teams to Score", pick: "Yes", odds: 250, confidence: 70, href: "/m", statusCode: null, view: { state: "upcoming", outcome: null, changedTo: null, finalScore: null, locked: false } } as any;
const paid = (kind: string) => ({ id: "p" + kind, category: "VIP", market: "Both Teams to Score", pick: "Yes", marketType: "BTTS", confidence: 78, reasoning: "Reason.", homeTeam: LONG_H, awayTeam: LONG_A, leagueName: "UEFA Champions League", leagueApiId: 2, kickoff: kick, marketConfirmation: null, paid: { status: "UPCOMING", statusLabel: "Upcoming", price: { odds: 250, bookmakers: 12, kind, at: "2026-11-14T09:00:00Z" }, publishedAt: "2026-11-13T10:00:00Z", reason: "Picked." } }) as any;
const combo = { id: "c", title: "50x accumulator", description: null, category: "PREMIUM", oddsTier: 50, legs: [250, 250, 250, 250].map((o, i) => ({ id: `l${i}`, matchLabel: `${LONG_H} vs ${LONG_A}`, market: "Both Teams to Score", pick: "Yes", odds: o })) } as any;
const trend = { id: "t", teamName: LONG_H, crestUrl: null, badge: { title: "Unbeaten", figure: "12", tone: "positive" }, sentence: [{ text: "Long unbeaten run." }], match: `${LONG_H} vs ${LONG_A}`, kickoff: "Sat 14 Nov", href: "/m", price: { label: "Both teams to score", odds: 250 } } as any;
const botd = { row: { id: "b", homeTeam: LONG_H, awayTeam: LONG_A, leagueApiId: 2, leagueName: "UEFA Champions League", kickoff: kick, market: "Both Teams to Score", pick: "Yes", marketType: "BTTS", selection: null, confidence: 77, reasoning: "x", matchPreview: null, outcome: "PENDING", category: "BET_OF_THE_DAY", homeTeamApiId: 51, awayTeamApiId: 163, betOfDayPinnedAt: null }, odds: null, oddsFetchedAt: new Date(Date.now() - 10 * 60_000), gate: { qualifies: true, reasons: [], price: 250, bookmakers: 12, impliedProbability: 0.4, edgePP: 4 } } as any;

const MEASURE = `(() => {
  var vw = document.documentElement.clientWidth;
  function vis(e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  var sections = {};
  ["pick", "saved", "paid", "combo", "trend", "botd"].forEach(function (id) {
    var s = document.getElementById(id);
    var over = Array.prototype.slice.call(s.querySelectorAll("*")).filter(function (e) { return vis(e) && e.getBoundingClientRect().right > vw + 1; }).length;
    var figs = Array.prototype.slice.call(s.querySelectorAll(".sr-only")).filter(function (e) { return /Decimal odds/.test(e.textContent); });
    var sizes = figs.map(function (e) { return parseFloat(getComputedStyle(e.parentElement).fontSize); });
    var clipped = figs.filter(function (e) { var p = e.parentElement; return p.scrollWidth > p.clientWidth + 1; }).length;
    var hidden = figs.every(function (e) { var r = e.getBoundingClientRect(); return r.width <= 1 && r.height <= 1; });
    sections[id] = { over: over, figs: figs.length, minFont: sizes.length ? Math.min.apply(null, sizes) : 0, clipped: clipped, hidden: hidden, text: s.innerText };
  });
  return { page: document.documentElement.scrollWidth, vw: vw, sections: sections };
})()`;

async function main() {
  const chromium = loadBrowser();
  if (!chromium) {
    if (process.env.REQUIRE_BROWSER === "1") {
      console.error("FAIL  no playwright / playwright-core, and REQUIRE_BROWSER=1");
      process.exit(1);
    }
    console.log("SKIP  no playwright / playwright-core installed: the layout cannot be measured here");
    return;
  }
  const root = join(__dirname, "..");
  const config = require(join(root, "tailwind.config.ts"));
  const css = (await postcss([tailwindcss({ ...(config.default ?? config), content: [join(root, "src/**/*.{ts,tsx}")] })]).process(readFileSync(join(root, "src/app/globals.css"), "utf8"), { from: join(root, "src/app/globals.css") })).css;
  const markup = renderToStaticMarkup(
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <section id="pick"><PickList><PickRow row={pick} reasons={["team"]} timezone="Africa/Lagos" /></PickList></section>
      <section id="saved"><ul><SavedRow item={saved} timezone="Africa/Lagos" /></ul></section>
      <section id="paid"><PredictionCard p={paid("entry")} /><PredictionCard p={paid("current")} /><PredictionCard p={paid("closing")} /></section>
      <section id="combo"><ComboCard combo={combo} locked={false} categoryLabel="Premium" bookmakers={[]} /></section>
      <section id="trend"><TrendCard card={trend} /></section>
      <section id="botd"><BetOfTheDayCard data={botd} variant="hero" /></section>
    </main>,
  );
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body>${markup}</body></html>`;
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    for (const width of [320, 375, 414, 768, 1440]) {
      const p = await browser.newPage({ viewport: { width, height: 900 } });
      await p.route("**/*", (r: any) => r.abort());
      await p.setContent(html);
      const m: any = await p.evaluate(MEASURE);
      console.log(`\n${width}px:`);
      check("no horizontal page overflow", m.page <= width, `scrollWidth ${m.page}`);
      for (const [id, s] of Object.entries<any>(m.sections)) {
        check(`${id}: prices present, none overflowing, none clipped`, s.figs > 0 && s.over === 0 && s.clipped === 0, `figs ${s.figs}, over ${s.over}, clipped ${s.clipped}`);
        check(`${id}: price text ≥ 11px; screen-reader text hidden`, s.minFont >= 11 && s.hidden, `min ${s.minFont}px, hidden ${s.hidden}`);
      }
      check("saved: 'when saved' is visible", /when saved/.test(m.sections.saved.text), m.sections.saved.text.replace(/\s+/g, " ").slice(0, 160));
      check("paid: the three quote labels are all visible", ["Price when published", "Latest quote", "Last quote before kickoff"].every((t) => m.sections.paid.text.toLowerCase().includes(t.toLowerCase())));
      check("combo: legs and the very wide product (four legs at 250.00) both render", m.sections.combo.text.includes("250.00") && m.sections.combo.text.includes("3906250000.00"));
      await p.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nThe odds surfaces fit at every width");
  if (failures) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
