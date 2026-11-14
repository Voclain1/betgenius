/** Actual local app, synthetic disposable DB. Chrome screenshots are review evidence, not visual approval. */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { encode } from "next-auth/jwt";
async function main() {
  const base = process.env.SPRINT08_PREVIEW_URL ?? "http://127.0.0.1:3000";
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
    throw new Error("Local preview only");
  const manifest = JSON.parse(
    readFileSync("work/sprint08-preview.json", "utf8"),
  );
  if (!manifest.synthetic) throw new Error("Synthetic manifest required");
  const { chromium } = require(
    process.env.PLAYWRIGHT_CORE_PATH ?? "playwright-core",
  );
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const folder =
    process.env.SPRINT08_SCREENSHOTS ?? "work/sprint08-screenshots";
  mkdirSync(folder, { recursive: true });
  let checks = 0;
  const ok = (v: unknown, message: string) => {
    assert.ok(v, message);
    checks++;
  };
  const errors: string[] = [];
  let dismissedPrompts = 0;
  const notificationDialog = (page: any) =>
    page.locator('[role="dialog"][aria-labelledby="push-onboarding-title"]');
  async function registerOnboardingHandler(page: any) {
    const dialog = notificationDialog(page);
    await page.addLocatorHandler(dialog, async () => {
      await dialog
        .getByRole("button", { name: "Not now", exact: true })
        .click();
      dismissedPrompts++;
    });
  }
  async function dismissOnboarding(page: any) {
    const dialog = notificationDialog(page);
    if (!(await dialog.isVisible())) return;
    // Do not let the automatic handler dismiss the target of this explicit click.
    await page.removeLocatorHandler(dialog);
    await dialog.getByRole("button", { name: "Not now", exact: true }).click();
    dismissedPrompts++;
    await registerOnboardingHandler(page);
  }

  async function context(width: number, height: number) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    await ctx.route("**/*", (route: any) =>
      new URL(route.request().url()).origin === base
        ? route.continue()
        : route.abort(),
    );
    const page = await ctx.newPage();
    page.on("pageerror", (e: Error) => errors.push(e.message));
    await registerOnboardingHandler(page);
    return { ctx, page };
  }
  async function checkLayout(page: any) {
    const dims = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      path: location.pathname,
      overflow: [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
        .filter((el) => {
          for (let p = el.parentElement; p; p = p.parentElement) {
            if (
              ["hidden", "auto", "scroll", "clip"].includes(
                getComputedStyle(p).overflowX,
              )
            )
              return false;
          }
          return true;
        })
        .slice(0, 16)
        .map((el) => ({
          tag: el.tagName,
          cls: String(el.className),
          right: Math.round(el.getBoundingClientRect().right),
          text: el.textContent?.slice(0, 55),
        })),
    }));
    ok(
      dims.document <= dims.viewport,
      `Horizontal overflow: ${JSON.stringify(dims)}`,
    );
  }
  async function visit(page: any, path: string) {
    const response = await page.goto(base + path, {
      waitUntil: "networkidle",
      timeout: 90000,
    });
    ok(response?.status() === 200, `HTTP 200 for ${path}`);
    await dismissOnboarding(page);
    const reject = page.getByRole("button", { name: "Reject", exact: true });
    if (await reject.isVisible()) await reject.click();
    const closeAd = page.getByRole("button", { name: "Close ad", exact: true });
    if (await closeAd.isVisible()) await closeAd.click();
    await checkLayout(page);
  }
  const discovery = `/predictions?d_date=${manifest.date}`;
  const snapshots: string[] = [];
  async function shot(page: any, name: string, anchor?: string) {
    await dismissOnboarding(page);
    if (anchor)
      await page
        .locator(anchor)
        .evaluate((el: HTMLElement) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({
      path: `${folder}/${name}.png`,
      animations: "disabled",
    });
    snapshots.push(`${name}.png`);
  }
  try {
    for (const [name, width, height] of [
      ["desktop", 1440, 1000],
      ["mobile", 390, 844],
      ["small-phone", 320, 740],
    ] as const) {
      const { ctx, page } = await context(width, height);
      await visit(page, discovery);
      ok(
        (await page.locator("#discover").innerText()).includes("12 matching"),
        "Anonymous accessible discovery count",
      );
      ok(
        !(await page.content()).includes("PRIVATE_PREVIEW_SELECTION"),
        "Paid selection absent from HTML and flight payload",
      );
      ok(
        (
          await page.locator('link[rel="canonical"]').getAttribute("href")
        ).endsWith("/predictions"),
        "Stable discovery canonical",
      );
      ok(
        (
          await page.locator('meta[name="robots"]').getAttribute("content")
        ).includes("noindex"),
        "Filtered discovery noindex",
      );
      if (name !== "small-phone") await shot(page, `${name}-discovery`);
      const form = page.getByRole("form", {
        name: "Filter published predictions",
      });
      await form.locator("details").evaluate((el: HTMLDetailsElement) => {
        el.open = true;
      });
      await form.locator('[name="d_team"]').fill("Preview Athletic 6");
      await form.locator('[name="d_market"]').selectOption("BTTS");
      await Promise.all([
        page.waitForURL(
          (url: URL) =>
            url.searchParams.get("d_market") === "BTTS" &&
            url.searchParams.get("d_team") === "Preview Athletic 6",
          { waitUntil: "domcontentloaded", timeout: 60000 },
        ),
        form.getByRole("button", { name: "Find predictions" }).click(),
      ]);
      await page.waitForFunction(
        () =>
          document
            .querySelector("#discover")
            ?.textContent?.includes("1 matching"),
        null,
        { timeout: 60000 },
      );
      ok(
        (await page.locator("#discover").innerText()).includes("1 matching"),
        "Team + market form submission",
      );
      ok(page.url().includes("d_market=BTTS"), "Shareable GET URL");
      await checkLayout(page);
      await visit(page, "/predictions/featured?date=tomorrow");
      ok(
        (await page.locator("#discover > details").getAttribute("open")) === null,
        "Category filters collapsed",
      );
      if (name !== "small-phone") await shot(page, `${name}-category`);
      await visit(
        page,
        `/predictions/featured?date=tomorrow&d_date=${manifest.date}&d_market=BTTS`,
      );
      ok(
        (await page.locator("#discover").innerText()).includes("6 matching"),
        "Category scope reused",
      );
      if (name !== "small-phone")
        await shot(page, `${name}-category-filtered`, "#discover");
      await visit(page, manifest.matchHref);
      if (name === "small-phone") {
        // Different system-font metrics exposed a genuine form-strip overflow in CI.
        const priorFont = await page.evaluate(
          () => document.body.style.fontFamily,
        );
        for (const font of ["Arial", "DejaVu Sans"]) {
          await page.evaluate((font: string) => {
            document.body.style.fontFamily = font;
          }, font);
          await checkLayout(page);
        }
        await page.evaluate((font: string) => {
          document.body.style.fontFamily = font;
        }, priorFont);
      }
      ok(
        !(await page.content()).includes("PRIVATE_PREVIEW_SELECTION"),
        "Paid match selection absent including flight payload",
      );
      ok(
        !(await page.content()).includes("PRIVATE_PREVIEW_FACTOR"),
        "Paid evidence absent",
      );
      ok(
        (await page
          .locator('section[aria-labelledby="evidence-guide"] > details')
          .getAttribute("open")) === null,
        "Evidence secondary and collapsed",
      );
      ok(
        (await page
          .locator('section[aria-labelledby="market-comparison"] > details')
          .getAttribute("open")) === null,
        "Comparison secondary and collapsed",
      );
      ok(
        await page.evaluate(
          () =>
            document.querySelector("#form")!.getBoundingClientRect().top <
            document.querySelector("#evidence-guide")!.getBoundingClientRect()
              .top,
        ),
        "Form precedes supporting evidence",
      );
      await page.locator("#evidence-guide").click();
      await page.locator("#market-comparison").click();
      ok(
        (
          await page
            .locator('section[aria-labelledby="evidence-guide"]')
            .innerText()
        ).includes("Went against it"),
        "Contradictory observations rendered",
      );
      ok(
        (
          await page
            .locator('section[aria-labelledby="market-comparison"]')
            .innerText()
        ).includes("1.91"),
        "Frozen publication quote rendered",
      );
      ok(
        (
          await page
            .locator('section[aria-labelledby="market-comparison"]')
            .innerText()
        ).includes("2.05"),
        "Separate cached quote rendered",
      );
      const schemas = await page
        .locator('script[type="application/ld+json"]')
        .allTextContents();
      for (const schema of schemas) {
        JSON.parse(schema);
        ok(!schema.includes("PRIVATE_PREVIEW"), "Structured data stays public");
      }
      if (name !== "small-phone") {
        await page.locator("#evidence-guide").click();
        await page.locator("#market-comparison").click();
        await page.evaluate(() => scrollTo(0, 0));
        await shot(page, `${name}-match`);
        await page.locator("#evidence-guide").click();
        await page.locator("#market-comparison").click();
        await shot(page, `${name}-evidence`, "#evidence-guide");
        await shot(page, `${name}-markets`, "#market-comparison");
      }
      await visit(page, manifest.missingHref);
      ok(
        (await page.locator("#evidence-guide").count()) === 0,
        "Empty evidence hidden",
      );
      ok(
        (await page.locator("#market-comparison").count()) === 0,
        "Empty comparison hidden",
      );
      await visit(page, "/?date=tomorrow");
      ok(
        await page.locator("#home-match-search").count(),
        "Compact homepage search present",
      );
      ok(
        (await page
          .getByRole("form", { name: "Filter published predictions" })
          .count()) === 0,
        "Homepage has no embedded finder",
      );
      if (name !== "small-phone") await shot(page, `${name}-home`);
      await ctx.close();
    }
    const { ctx, page } = await context(390, 844);
    const token = await encode({
      secret: process.env.NEXTAUTH_SECRET ?? "sprint08-local-preview-only",
      maxAge: 3600,
      token: {
        uid: manifest.userId,
        sub: manifest.userId,
        role: "USER",
        email: "sprint08-preview@example.invalid",
      },
    });
    await ctx.addCookies([
      {
        name: "next-auth.session-token",
        value: token,
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const save = await ctx.request.post(`${base}/api/saved-predictions`, {
      headers: { Origin: base },
      data: { predictionId: manifest.firstId },
    });
    ok(
      save.status() === 200 || save.status() === 201,
      "Existing save API prepares an idempotent bookmark",
    );
    await visit(page, `${discovery}&d_personal=favourites`);
    const personalised = await page.locator("#discover").innerText();
    ok(personalised.includes("America/New_York"), "Stored timezone used");
    ok(
      personalised.includes("3 matching"),
      "Followed teams include entitled markets",
    );
    ok(
      (await page.content()).includes("PRIVATE_PREVIEW_SELECTION"),
      "Entitled Premium access retained",
    );
    ok(
      !(await page.locator("head").innerHTML()).includes(
        "PRIVATE_PREVIEW_SELECTION",
      ),
      "Personalisation never changes public metadata to paid copy",
    );
    await visit(page, `${discovery}&d_personal=saved`);
    ok(
      (await page.locator("#discover").innerText()).includes("1 matching"),
      "Saved filter uses existing bookmark",
    );
    await shot(page, "mobile-saved", "#discover");
    const remove = page
      .getByRole("button", { name: "Remove from saved predictions" })
      .first();
    await remove.click();
    await page
      .getByRole("button", { name: "Save prediction", exact: true })
      .first()
      .waitFor();
    await page.reload({ waitUntil: "networkidle" });
    ok(
      (await page.locator("#discover").innerText()).includes("0 matching"),
      "Existing save API persists removal",
    );
    await ctx.close();
    ok(errors.length === 0, `No runtime errors: ${errors.join("; ")}`);
    writeFileSync(
      `${folder}/results.json`,
      JSON.stringify(
        {
          synthetic: true,
          assertions: checks,
          viewports: [1440, 390, 320],
          snapshots,
        },
        null,
        2,
      ),
    );
    console.log(
      `Sprint 08 browser: ${checks} assertions passed at desktop, phone and small-phone widths; ${snapshots.length} screenshots in ${folder}; ${dismissedPrompts} notification prompts dismissed through Not now`,
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
