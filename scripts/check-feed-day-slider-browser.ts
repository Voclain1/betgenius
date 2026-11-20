/**
 * Touch-first date navigation regression. Run against the disposable local
 * preview in prediction-discovery CI, never against production.
 *
 * Checks no document overflow, native horizontal scrolling, selected-day
 * visibility after hydration, and independent day links on home and feeds.
 */
export {};
const failures: string[] = [];
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures.push(label);
}
function browserPackage() {
  for (const name of ["playwright-core", "playwright"]) {
    try { return require(name).chromium; } catch { /* try the next package */ }
  }
  return null;
}
async function main() {
  const base = process.env.BASE_URL;
  const chromium = browserPackage();
  if (!base || !chromium) {
    if (process.env.REQUIRE_BROWSER === "1") throw new Error("Browser and BASE_URL required");
    console.log("SKIP: no browser preview configured");
    return;
  }
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    for (const width of [320, 375, 768, 1280]) {
      for (const path of ["/", "/predictions/genius", "/predictions/btts", "/predictions/featured?date=day-5"]) {
        const context = await browser.newContext({ viewport: { width, height: 820 } });
        await context.addInitScript(() => {
          try { localStorage.setItem("bg_consent_v1", "denied"); } catch { /* no-op */ }
        });
        await context.route(/media\.api-sports\.io|googlesyndication|google-analytics|googletagmanager|doubleclick/,
          (route: any) => route.abort());
        const page = await context.newPage();
        await page.goto(base + path, { waitUntil: "domcontentloaded" });
        const strip = page.locator('[data-testid="feed-day-strip"]').first();
        await strip.waitFor({ state: "attached", timeout: 10000 });
        // Effects position the active day; this is not the same as waiting for images.
        await page.waitForTimeout(250);
        const data = await strip.evaluate((root: Element) => {
          const rail = root.querySelector('[data-testid="feed-day-track"]') as HTMLElement;
          const active = root.querySelector('a[aria-current="page"]') as HTMLElement;
          const activeBox = active?.getBoundingClientRect();
          const railBox = rail.getBoundingClientRect();
          return {
            links: rail.querySelectorAll("a[data-feed-day]").length,
            width: rail.clientWidth,
            scrollWidth: rail.scrollWidth,
            scrollLeft: rail.scrollLeft,
            active: active?.dataset.feedDay,
            selectedVisible: !!activeBox && activeBox.left >= railBox.left - 2
              && activeBox.right <= railBox.right + 2,
            noPageOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
            selectedCount: rail.querySelectorAll('a[aria-current="page"]').length,
          };
        });
        const tag = `${width}px ${path}`;
        check(`${tag}: seven date links (Yesterday through Day 5)`, data.links === 7);
        check(`${tag}: exactly one active date`, data.selectedCount === 1);
        check(`${tag}: date strip does not widen page`, data.noPageOverflow);
        if (width < 768) {
          check(`${tag}: swipe overflow exists`, data.scrollWidth > data.width + 75);
        }
        if (path.includes("day-5")) {
          check(`${tag}: selected future date is immediately visible`,
            data.active === "day-5" && data.selectedVisible,
            JSON.stringify({ active: data.active, left: data.scrollLeft }));
        }
        if (width === 375 && path === "/predictions/genius") {
          await strip.locator('[data-testid="feed-day-track"]').evaluate((el: Element) => {
            (el as HTMLElement).scrollLeft = 200;
          });
          await page.waitForTimeout(200);
          const scrolled = await strip.locator('[data-testid="feed-day-track"]').evaluate(
            (el: Element) => (el as HTMLElement).scrollLeft);
          check("native swipe rail moves sideways", scrolled > 25, String(scrolled));
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length) throw Error(`${failures.length} date-navigation checks failed`);
  console.log("PASS: responsive prediction date slider");
}
main().catch(error => { console.error(error); process.exit(1); });
