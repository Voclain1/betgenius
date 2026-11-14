import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
async function main() {
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
  assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
  const { chromium } = require(
    process.env.PLAYWRIGHT_CORE_PATH ?? "playwright-core",
  );
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const manifest = JSON.parse(
    readFileSync("work/sprint08-preview.json", "utf8"),
  );
  assert.equal(manifest.synthetic, true);
  const dir = "work/release-screenshots";
  mkdirSync(dir, { recursive: true });
  let checks = 0;
  const results: any[] = [];
  try {
    for (const width of [320, 390, 768, 1440]) {
      const ctx = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      await ctx.addInitScript(() => {
        localStorage.setItem("bg_consent_v1", "denied");
        localStorage.setItem("bg_install_dismissed", "1");
      });
      await ctx.route("**/*", (r: any) =>
        new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
      );
      const p = await ctx.newPage();
      await p.addLocatorHandler(
        p.locator('[aria-labelledby="push-onboarding-title"]'),
        async () => {
          await p.getByRole("button", { name: "Not now", exact: true }).click();
        },
      );
      const routes = [
        "/",
        "/predictions",
        "/predictions/today",
        "/predictions/genius",
        "/predictions/featured",
        "/predictions/banker",
        "/predictions/bet-of-the-day",
        "/predictions/goals",
        "/predictions/btts",
        "/predictions/vip",
        "/predictions/premium",
        manifest.matchHref,
        "/track-record",
        "/pricing",
        "/login",
        "/register",
      ];
      for (const path of routes) {
        const response = await p.goto(base + path, {
          waitUntil: "networkidle",
        });
        assert.equal(response?.status(), 200, path);
        checks++;
        const dimensions = await p.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        assert.ok(
          dimensions.scroll <= dimensions.width,
          `${width} ${path} overflow ${JSON.stringify(dimensions)}`,
        );
        checks++;
        if (
          [390, 1440].includes(width) &&
          [
            "/",
            "/predictions",
            manifest.matchHref,
            "/track-record",
            "/pricing",
            "/login",
            "/register",
            "/predictions/goals",
          ].includes(path)
        ) {
          await p.evaluate(() => {
            const b = document.createElement("div");
            b.textContent = "LOCAL QA · SYNTHETIC DATA · NOT PRODUCTION";
            b.style.cssText =
              "position:fixed;bottom:0;left:0;right:0;background:#151c28;color:#facc15;z-index:99999;font:10px sans-serif;text-align:center;padding:4px";
            document.body.append(b);
          });
          await p.screenshot({
            path: `${dir}/${width}-${path === "/" ? "home" : path === manifest.matchHref ? "match" : path.slice(1).replaceAll("/", "-")}.png`,
            fullPage: true,
          });
        }
        results.push({
          width,
          path,
          status: response?.status(),
          ...dimensions,
        });
      }
      // Test actual pricing -> login -> registration links without creating a payment.
      for (const tier of ["vip", "premium"]) {
        await p.goto(`${base}/pricing#plan-${tier}`);
        const card = p.locator(`#plan-${tier}`);
        await card
          .getByRole("button", { name: /choose|subscribe|get|upgrade/i })
          .first()
          .click();
        await p.waitForURL("**/login?callbackUrl=*");
        const dest = new URL(p.url()).searchParams.get("callbackUrl");
        assert.equal(dest, `/pricing#plan-${tier}`);
        checks++;
        const register = p.getByRole("link", {
          name: "Create one",
          exact: true,
        });
        assert.equal(
          new URL(await register.getAttribute("href"), base).searchParams.get(
            "callbackUrl",
          ),
          dest,
        );
        checks++;
        await register.click();
        await p.waitForURL("**/register?callbackUrl=*");
        assert.equal(new URL(p.url()).searchParams.get("callbackUrl"), dest);
        checks++;
      }
      await ctx.close();
    }
    // Real registration and credentials session, only on the disposable local preview.
    for (const tier of ["vip", "premium"]) {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 900 },
      });
      await ctx.route("**/*", (r: any) =>
        new URL(r.request().url()).origin === base &&
        !/\/api\/(payments|subscription)\//.test(
          new URL(r.request().url()).pathname,
        )
          ? r.continue()
          : r.abort(),
      );
      const p = await ctx.newPage();
      p.setDefaultTimeout(15000);
      p.setDefaultNavigationTimeout(30000);
      await p.addLocatorHandler(
        p.locator('[aria-labelledby="push-onboarding-title"]'),
        async () => {
          await p.getByRole("button", { name: "Not now", exact: true }).click();
        },
      );
      await p.goto(
        `${base}/register?callbackUrl=${encodeURIComponent(`/pricing#plan-${tier}`)}`,
      );
      await p
        .getByLabel("Email", { exact: true })
        .fill(`release-${tier}-${Date.now()}@example.invalid`);
      await p
        .getByLabel("Password", { exact: true })
        .fill("Disposable-preview-only-2026!");
      await p
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await p.waitForURL(`${base}/pricing#plan-${tier}`);
      checks++;
      const session = await (
        await ctx.request.get(`${base}/api/auth/session`)
      ).json();
      assert.equal(session.user.tier, "FREE");
      checks++;
      await ctx.close();
    }
  } finally {
    await browser.close();
    writeFileSync(
      "work/final-browser-results.json",
      JSON.stringify({ synthetic: true, checks, results }, null, 2),
    );
  }
  console.log(
    `Release browser: ${checks} assertions passed at 320, 390, 768, 1440px`,
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
