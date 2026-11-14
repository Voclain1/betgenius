/**
 * Sprint 07 — the real homepage in a real browser, at 320, 375, 414, 768 and
 * 1440px. It reads a RUNNING site (BASE_URL, e.g. http://localhost:3000 from
 * `next start`), signed out, and measures what a first-time visitor gets:
 *
 *   - no sideways page overflow, one H1;
 *   - "Today's tips" and the "Join free" line are inside the first screen;
 *   - the category buttons are one scrolling line on a phone (not a wrapped
 *     block), every pill at least 36px tall, all of them present with the right
 *     destinations, the market chips and longer runs intact;
 *   - the four tool tiles are present, include match research, and fit;
 *   - the "View all" and "All leagues" links are at least 36px tall;
 *   - nothing on the page says AI.
 *
 * Skips (exit 0) when BASE_URL is unset or no browser is installed, unless
 * REQUIRE_BROWSER=1. Reads one public page; writes nothing.
 *
 * Run: BASE_URL=http://localhost:3000 npx tsx scripts/check-homepage-experience-browser.ts
 */
export {};

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

const MEASURE = `(() => {
  var vh = innerHeight, vw = document.documentElement.clientWidth;
  function vis(e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function byText(sel, t) { return Array.prototype.slice.call(document.querySelectorAll(sel)).filter(vis).filter(function (e) { return (e.textContent || "").trim().indexOf(t) === 0; })[0]; }
  var cta = byText("main a", "Today's tips"), join = byText("main a", "Join free");
  var nav = document.querySelector('nav[aria-label="Prediction categories"]');
  var navLinks = nav ? Array.prototype.slice.call(nav.querySelectorAll("a")).filter(vis) : [];
  var pillRows = nav ? Array.prototype.slice.call(nav.querySelectorAll("div")).filter(function (d) { return getComputedStyle(d).overflowX === "auto" || /sm:flex-wrap/.test(d.className); }) : [];
  var tiles = ["/match-insights", "/livescores", "/bet-builder", "/statspad"].map(function (h) { return Array.prototype.slice.call(document.querySelectorAll('main a.group[href="' + h + '"]')).filter(vis)[0]; }).filter(Boolean);
  var arrows = ["View all →", "All leagues →"].map(function (t) { var e = byText("main a", t); return e ? [t, Math.round(e.getBoundingClientRect().height)] : [t, 0]; });
  return {
    page: document.documentElement.scrollWidth, vw: vw, vh: vh,
    h1s: document.querySelectorAll("h1").length,
    ctaTop: cta ? Math.round(cta.getBoundingClientRect().top) : null, ctaBottom: cta ? Math.round(cta.getBoundingClientRect().bottom) : null,
    joinTop: join ? Math.round(join.getBoundingClientRect().top) : null, joinHref: join ? join.getAttribute("href") : null, joinH: join ? Math.round(join.getBoundingClientRect().height) : 0,
    navLinks: navLinks.map(function (a) { return [(a.textContent || "").trim(), a.getAttribute("href"), Math.round(a.getBoundingClientRect().height)]; }),
    rowHeights: pillRows.map(function (r) { return Math.round(r.getBoundingClientRect().height); }),
    navHeight: nav ? Math.round(nav.getBoundingClientRect().height) : 0,
    tiles: tiles.map(function (t) { var r = t.getBoundingClientRect(); return [t.getAttribute("href"), Math.round(r.width), Math.round(r.right)]; }),
    arrows: arrows,
    hasAi: /\\bAI\\b/.test(document.body.innerText)
  };
})()`;

async function main() {
  const base = process.env.BASE_URL;
  const chromium = loadBrowser();
  if (!base || !chromium) {
    const why = !base ? "BASE_URL is not set (point it at a running site)" : "no playwright / playwright-core installed";
    if (process.env.REQUIRE_BROWSER === "1") {
      console.error(`FAIL  ${why}, and REQUIRE_BROWSER=1`);
      process.exit(1);
    }
    console.log(`SKIP  ${why}: the real homepage cannot be measured here`);
    return;
  }
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const WANT_PILLS: [string, string][] = [
    ["Banker Tips", "/predictions/banker"], ["Today's Tips", "/predictions/today"], ["Genius Tips", "/predictions/genius"], ["Featured Tips", "/predictions/featured"],
    ["Premium Tips", "/predictions/premium"], ["VIP Tips", "/predictions/vip"], ["Goals Tips", "/predictions/goals"], ["Multi Bet Tips", "/multi-bets"],
    ["Straight Wins", "/predictions/straight-wins"], ["Double Chance", "/predictions/double-chance"], ["BTTS", "/predictions/btts"], ["Over 2.5", "/predictions/over-2-5-goals"],
    ["Weekend Tips", "/predictions/weekend"], ["Midweek Tips", "/predictions/midweek"],
  ];
  try {
    for (const width of [320, 375, 414, 768, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: width >= 768 ? 900 : 800 } });
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem("bg_consent_v1", "denied");
          localStorage.setItem("bg_install_dismissed", "1");
        } catch {
          /* storage unavailable */
        }
        document.addEventListener("DOMContentLoaded", () => {
          const st = document.createElement("style");
          st.textContent = '[aria-labelledby="push-onboarding-title"]{display:none!important}';
          document.head.appendChild(st);
        });
      });
      await ctx.route(/media\.api-sports\.io|googlesyndication|google-analytics|googletagmanager|doubleclick/, (r: any) => r.abort());
      const p = await ctx.newPage();
      await p.goto(base + "/", { waitUntil: "domcontentloaded" });
      await p.waitForLoadState("networkidle");
      await p.waitForTimeout(500);
      const m: any = await p.evaluate(MEASURE);
      console.log(`\n${width}px:`);
      check("no sideways page overflow", m.page <= width, `scrollWidth ${m.page}`);
      check("one H1", m.h1s === 1, String(m.h1s));
      check("'Today's tips' is inside the first screen", m.ctaTop !== null && m.ctaBottom <= m.vh, `${m.ctaTop}–${m.ctaBottom} of ${m.vh}`);
      if (width >= 375) check("'Join free' (to /register) is inside the first screen on a phone and up", m.joinTop !== null && m.joinTop < m.vh && m.joinHref === "/register", `top ${m.joinTop}, href ${m.joinHref}`);
      else check("'Join free' is present, linking to /register", m.joinHref === "/register");
      check("'Join free' is at least 36px tall", m.joinH >= 36, String(m.joinH));
      const got = new Map<string, string>(m.navLinks.map((l: any[]) => [l[0], l[1]]));
      check("all 14 category, market and longer-run links are present with the right destinations", WANT_PILLS.every(([t, h]) => got.get(t) === h), WANT_PILLS.filter(([t, h]) => got.get(t) !== h).map(([t]) => t).join());
      // 36px on a phone or tablet (touch); the market chips are 32px from 768px, where a pointer is the norm (Sprint 03).
      const minTap = width < 768 ? 36 : 32;
      check(`every category link is at least ${minTap}px tall`, m.navLinks.filter((l: any[]) => l[2] < minTap).length === 0, JSON.stringify(m.navLinks.filter((l: any[]) => l[2] < minTap)));
      if (width < 640) check("the pill rows are single lines (≤ 48px each), not a wrapped block", m.rowHeights.length >= 2 && m.rowHeights.every((h: number) => h <= 48), `rows ${m.rowHeights.join("/")}, nav ${m.navHeight}px`);
      else check("the pills wrap and fit from sm up", m.rowHeights.every((h: number) => h <= 96), `rows ${m.rowHeights.join("/")}`);
      check("four tool tiles, including match research, all inside the viewport", m.tiles.length === 4 && m.tiles.some((t: any[]) => t[0] === "/match-insights") && m.tiles.every((t: any[]) => t[2] <= width), JSON.stringify(m.tiles));
      check("'View all →' and 'All leagues →' are at least 36px tall", m.arrows.every((a: any[]) => a[1] >= 36), JSON.stringify(m.arrows));
      check("no copy says AI", !m.hasAi);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nThe homepage behaves at every width");
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
