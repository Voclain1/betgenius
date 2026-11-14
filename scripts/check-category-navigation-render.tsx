/**
 * Sprint 04 — the header marks the page the reader is on (render tier).
 *
 * Renders the real <Nav /> for several pathnames and reads the markup:
 *   - on a Tips page the "Tips" trigger is marked, on any other page it is not;
 *   - on a primary link's page (e.g. /multi-bets) that link carries
 *     aria-current="page" and nothing else does;
 *   - exactly one element is current at a time, and none on the homepage;
 *   - the menu is closed until opened (no 20-link block in the page's HTML).
 * The open dropdown and the drawer are client state, so they are exercised in
 * a real browser by check-category-navigation-browser.ts.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-category-navigation-render.tsx
 */
import "./lib/reactCacheShim";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionProvider } from "next-auth/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { Nav } from "../src/components/Nav";

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
};

const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop } as any;
const render = (pathname: string) =>
  renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={pathname}>
        <SessionProvider session={null} refetchOnWindowFocus={false}>
          <Nav />
        </SessionProvider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
const count = (h: string, needle: string) => h.split(needle).length - 1;
const tipsTrigger = (h: string) => /<button[^>]*aria-haspopup="true"[^>]*>Tips/.exec(h)?.[0] ?? "";

console.log("\nthe Tips trigger shows where the reader is");
for (const p of ["/predictions/today", "/predictions/weekend", "/predictions/btts", "/predictions/bet-of-the-day"]) {
  check(`${p}: Tips is marked`, tipsTrigger(render(p)).includes("font-semibold"));
}
for (const p of ["/", "/multi-bets", "/predictions", "/livescores", "/predictions/match/a-vs-b-2026-01-01"]) {
  check(`${p}: Tips is not marked`, !tipsTrigger(render(p)).includes("font-semibold"));
}

console.log("\nprimary links");
const multi = render("/multi-bets");
check("/multi-bets: the Multi Bets link is current", /aria-current="page"[^>]*href="\/multi-bets"|href="\/multi-bets"[^>]*aria-current="page"/.test(multi));
check("/multi-bets: exactly one element is current", count(multi, 'aria-current="page"') === 1, String(count(multi, 'aria-current="page"')));
check("/: nothing is current", count(render("/"), 'aria-current="page"') === 0);
check("/predictions/today: no primary link is current", count(render("/predictions/today"), 'aria-current="page"') === 0);
check("/match-insights: Insights current, Bet Builder not", /href="\/match-insights"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/match-insights"/.test(render("/match-insights")) && !/href="\/bet-builder"[^>]*aria-current/.test(render("/match-insights")));

console.log("\nweight and access");
const h = render("/predictions/today");
check("menus are closed in the page's HTML (no group headings, no Weekend link)", !h.includes("By day") && !h.includes("/predictions/weekend"));
check("the Tips trigger names its state to assistive tech", /aria-expanded="false"/.test(tipsTrigger(h)));
check("the header says nothing about AI", !/\bAI\b/.test(h.replace(/<[^>]+>/g, " ")));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
