/**
 * Sprint 06 — the returning-user journey fits and is operable on a phone
 * (component-level, Chromium). Same method as check-nav-fit.tsx: compile the
 * real Tailwind CSS, render the real components, measure at five widths.
 *
 *   1. The signed-in public header (where /following lives) fits at 320, 360,
 *      375 and 414px: no sideways overflow, and every control in it is at least
 *      36px wide and tall (the theme toggle used to be squeezed to 18px).
 *   2. The account shell with the dashboard's jump row and the saved list's
 *      scrolling filter bar: no sideways page overflow at any width (a wide
 *      child used to widen the whole page), jump links ≥ 36px tall.
 *   3. A closed phone sidebar has no visible, focusable control (it used to
 *      leave 20 in the keyboard order); from md it is visible.
 *   4. Following is in the sidebar.
 *
 * Skips (exit 0) with no browser, unless REQUIRE_BROWSER=1.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-return-experience-browser.tsx
 */
import "./lib/reactCacheShim";
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionProvider } from "next-auth/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { Nav } from "../src/components/Nav";
import { DashboardShell } from "../src/components/DashboardShell";
import { JumpRow, SavedRow } from "../src/components/personal/DashboardParts";
import { jumpLinks } from "../src/lib/returnShortcuts";
import { dashboardNavItems } from "../src/lib/dashboardContext";

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

const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop } as any;
const expires = "2099-01-01T00:00:00.000Z";
const session = { user: { name: "Reader", email: "reader@example.com", role: "USER", tier: "FREE" }, expires };

const header = renderToStaticMarkup(
  <AppRouterContext.Provider value={router}>
    <PathnameContext.Provider value="/following">
      <SessionProvider session={session as any} refetchOnWindowFocus={false}>
        <Nav />
      </SessionProvider>
    </PathnameContext.Provider>
  </AppRouterContext.Provider>,
);

const none = { FEATURED: true, GENIUS: true, TODAY: true, BANKER: true, VIP: false, PREMIUM: false, BET_OF_THE_DAY: true, SAME_GAME_DOUBLE: true, GOALS: true } as any;
const saved = { id: "s", predictionId: "p", homeTeam: "Brighton & Hove Albion", awayTeam: "Borussia Mönchengladbach", homeTeamApiId: 51, awayTeamApiId: 163, leagueApiId: 2, leagueName: "UEFA Champions League", kickoff: new Date(), settledAt: new Date(), savedAt: new Date(), category: "TODAY", market: "Both Teams to Score", pick: "Yes", odds: 2.1, confidence: 70, href: "/m", statusCode: null, view: { state: "settled", outcome: "WON", changedTo: null, finalScore: "2-1", locked: false } } as any;
const FILTERS = ["All", "Upcoming", "Settled", "Won", "Lost"];
const shell = renderToStaticMarkup(
  <DashboardShell items={dashboardNavItems(none)} activeKey="overview" title="My dashboard" userEmail="a.very.long.reader.email.address@example-domain.com">
    <div className="max-w-3xl space-y-5">
      <JumpRow links={jumpLinks({ savedTotal: 12, upcomingCount: 4, favouriteCount: 9 })} />
      <nav aria-label="Filter saved predictions" className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
        {FILTERS.map((f) => <a key={f} href="#" className="inline-flex min-h-9 shrink-0 items-center rounded-lg px-3 text-sm font-semibold">{f}<span className="ml-1.5 tabular-nums">12</span></a>)}
      </nav>
      <ul><SavedRow item={saved} timezone="Africa/Lagos" /></ul>
    </div>
  </DashboardShell>,
);

const wrap = (css: string, body: string) => `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body>${body}</body></html>`;

const HEADER_JS = `(() => {
  var vw = document.documentElement.clientWidth;
  var h = document.querySelector("header > div");
  var items = Array.prototype.slice.call(h.children).filter(function (e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  var controls = items.filter(function (e) { return e.tagName === "A" && e.getAttribute("aria-label") !== "BetGenius home" || e.tagName === "BUTTON"; });
  return {
    page: document.documentElement.scrollWidth, vw: vw,
    small: controls.map(function (e) { var r = e.getBoundingClientRect(); return [e.getAttribute("aria-label") || e.tagName, Math.round(r.width), Math.round(r.height)]; }).filter(function (c) { return c[1] < 36 || c[2] < 36; })
  };
})()`;
const SHELL_JS = `(() => {
  var vw = document.documentElement.clientWidth;
  var aside = document.querySelector("aside");
  var sidebarLinks = Array.prototype.slice.call(aside.querySelectorAll("a,button"));
  var reachable = sidebarLinks.filter(function (e) { return getComputedStyle(e).visibility !== "hidden"; }).length;
  var jump = Array.prototype.slice.call(document.querySelectorAll('nav[aria-label="Jump to your sections"] a'));
  var jumpShown = jump.filter(function (e) { var r = e.getBoundingClientRect(); return r.width > 0; });
  return {
    page: document.documentElement.scrollWidth, vw: vw,
    reachable: reachable, asideVisibility: getComputedStyle(aside).visibility,
    hasFollowing: sidebarLinks.some(function (e) { return e.getAttribute("href") === "/following"; }),
    jumpCount: jumpShown.length, jumpMinH: jumpShown.length ? Math.round(Math.min.apply(null, jumpShown.map(function (e) { return e.getBoundingClientRect().height; }))) : 0
  };
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
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    for (const width of [320, 360, 375, 414, 768, 1440]) {
      console.log(`\n${width}px:`);
      const p = await browser.newPage({ viewport: { width, height: 900 } });
      await p.route("**/*", (r: any) => r.abort());
      await p.setContent(wrap(css, header));
      const h: any = await p.evaluate(HEADER_JS);
      check("signed-in header: no sideways overflow", h.page <= width, `scrollWidth ${h.page}`);
      if (width < 1024) check("signed-in header: every control is at least 36px wide and tall", h.small.length === 0, JSON.stringify(h.small));
      await p.setContent(wrap(css, shell));
      const s: any = await p.evaluate(SHELL_JS);
      check("account shell: no sideways page overflow (wide filter bar, long email)", s.page <= width, `scrollWidth ${s.page}`);
      check("Following is in the sidebar", s.hasFollowing);
      if (width < 768) {
        check("closed phone sidebar: no visible, focusable control", s.reachable === 0 && s.asideVisibility === "hidden", `reachable ${s.reachable}, ${s.asideVisibility}`);
      } else {
        check("sidebar is visible from md", s.asideVisibility === "visible" && s.reachable > 0, `reachable ${s.reachable}`);
      }
      if (width < 1024) check("jump row: 4 links, each ≥ 36px tall", s.jumpCount === 4 && s.jumpMinH >= 36, `count ${s.jumpCount}, min ${s.jumpMinH}`);
      else check("jump row is hidden from lg (sections sit side by side)", s.jumpCount === 0, `count ${s.jumpCount}`);
      await p.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nThe returning-user surfaces fit at every width");
  if (failures) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
