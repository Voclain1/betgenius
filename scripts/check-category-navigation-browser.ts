/**
 * Sprint 04 — the Tips menu and phone drawer in a real browser.
 *
 * The open dropdown and the drawer are client state, so the render check
 * cannot see them. This opens each against a RUNNING site (BASE_URL, for
 * example http://localhost:3000 from `next start`) at 320, 375, 414, 768 and
 * 1440px and measures what a reader gets:
 *   - no sideways page overflow with the menu open;
 *   - the menu holds all three groups, with Weekend, Midweek and Bet of the Day;
 *   - the page the reader is on is the one aria-current link;
 *   - every link is at least 36px tall and inside the viewport;
 *   - Escape closes it, and the keyboard can reach the first link.
 *
 * Skips (exit 0) when BASE_URL is unset or no browser is installed, unless
 * REQUIRE_BROWSER=1. It reads public pages only and writes nothing.
 *
 * Run: BASE_URL=http://localhost:3000 npx tsx scripts/check-category-navigation-browser.ts
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

// Plain script strings: functions serialised by tsx carry a `__name` helper the page lacks.
const MEASURE = (wide: boolean) => `(() => {
  var root = ${wide ? `document.querySelector('header nav [id^="nav-menu"]')` : `document.getElementById("mobile-nav-drawer")`};
  if (!root) return null;
  var links = Array.prototype.slice.call(root.querySelectorAll("a"));
  var rects = links.map(function (a) { return a.getBoundingClientRect(); });
  var text = root.textContent || "";
  return {
    labels: links.map(function (a) { return a.textContent.trim(); }),
    current: links.filter(function (a) { return a.getAttribute("aria-current") === "page"; }).map(function (a) { return a.getAttribute("href"); }),
    headings: Array.prototype.slice.call(root.querySelectorAll('[role="group"]')).map(function (g) { return g.getAttribute("aria-label"); }),
    minH: Math.round(Math.min.apply(null, rects.map(function (r) { return r.height; }))),
    maxRight: Math.round(Math.max.apply(null, rects.map(function (r) { return r.right; }))),
    minLeft: Math.round(Math.min.apply(null, rects.map(function (r) { return r.left; }))),
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    pageWidth: document.documentElement.scrollWidth,
    overflowElements: Array.prototype.slice.call(document.querySelectorAll("body *")).filter(function(e) { return e.getBoundingClientRect().right > innerWidth + 1; }).slice(0,16).map(function(e) { return {tag:e.tagName,cls:String(e.className),right:Math.round(e.getBoundingClientRect().right),text:e.textContent.slice(0,55)}; }),
    vw: innerWidth,
    rootBottom: Math.round(root.getBoundingClientRect().bottom),
    vh: innerHeight,
    currentInView: (function () { var c = root.querySelector('[aria-current="page"]'); if (!c) return false; var r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })(),
    hasAi: /\\bAI\\b/.test(text)
  };
})()`;

async function main() {
  const base = process.env.BASE_URL;
  const strict = process.env.REQUIRE_BROWSER === "1";
  const chromium = loadBrowser();
  if (!base || !chromium) {
    const why = !base ? "BASE_URL is not set (point it at a running site)" : "no playwright / playwright-core installed";
    if (strict) {
      console.error(`FAIL  ${why}, and REQUIRE_BROWSER=1`);
      process.exit(1);
    }
    console.log(`SKIP  ${why}: the open menu cannot be measured here`);
    return;
  }
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    for (const width of [320, 375, 414, 768, 1440]) {
      const wide = width >= 1024;
      for (const path of ["/predictions/btts", "/predictions/weekend", "/predictions/bet-of-the-day"]) {
        const ctx = await browser.newContext({ viewport: { width, height: 800 } });
        await ctx.addInitScript(() => {
          try {
            localStorage.setItem("bg_consent_v1", "denied");
            localStorage.setItem("bg_install_dismissed", "1");
          } catch {
            /* storage unavailable */
          }
        });
        await ctx.route(/media\.api-sports\.io|googlesyndication|google-analytics|googletagmanager|doubleclick/, (r: any) => r.abort());
        const p = await ctx.newPage();
        await p.goto(base + path, { waitUntil: "domcontentloaded" });
        await p.addStyleTag({ content: '[aria-labelledby="push-onboarding-title"]{display:none!important}' });
        await p.evaluate(() => document.fonts.ready);
        if (wide) await p.getByRole("button", { name: /^Tips/ }).first().click();
        else await p.getByRole("button", { name: "Open menu" }).click();
        await p.waitForTimeout(300);
        const m: any = await p.evaluate(MEASURE(wide));
        console.log(`\n${width}px ${wide ? "dropdown" : "drawer"} on ${path}:`);
        if (!m) {
          check("the menu opens", false);
          await ctx.close();
          continue;
        }
        check("no sideways page overflow with the menu open", !m.pageOverflow, m.pageOverflow ? JSON.stringify({width:m.pageWidth,viewport:m.vw,elements:m.overflowElements}) : "");
        check("links are inside the viewport", m.minLeft >= 0 && m.maxRight <= m.vw, `left ${m.minLeft}, right ${m.maxRight}/${m.vw}`);
        check("every link is ≥ 36px tall", m.minH >= 36, `min ${m.minH}`);
        check("three groups: By day, Curated tips, By market", ["By day", "Curated tips", "By market"].every((h) => m.headings.includes(h)), m.headings.join());
        check("Weekend, Midweek, Bet of the Day and Banker are all offered, as separate links", ["Weekend", "Midweek", "Bet of the Day", "Banker"].every((l) => m.labels.some((x: string) => x.startsWith(l))));
        check("exactly one link is the current page, and it is this page", m.current.length === 1 && m.current[0] === path, m.current.join());
        if (!wide) check("the current page is in view when the drawer opens", m.currentInView);
        if (wide) check("the dropdown fits below the header in the viewport", m.rootBottom <= m.vh, `bottom ${m.rootBottom}/${m.vh}`);
        check("no copy says AI", !m.hasAi);
        if (wide) {
          await p.keyboard.press("Escape");
          await p.waitForTimeout(150);
          check("Escape closes the dropdown", (await p.evaluate(MEASURE(true))) === null);
          await p.getByRole("button", { name: /^Tips/ }).first().focus();
          await p.keyboard.press("Enter");
          await p.keyboard.press("Tab");
          const focused = await p.evaluate(`(document.activeElement && document.activeElement.tagName) + ":" + (document.activeElement && document.activeElement.textContent || "").trim()`);
          check("the keyboard reaches the first menu link", /^A:/.test(focused), focused);
        } else {
          await p.keyboard.press("Escape");
          await p.waitForTimeout(250);
          check("Escape closes the drawer", (await p.evaluate(MEASURE(false))) === null);
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nThe Tips menu and drawer behave at every width");
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
