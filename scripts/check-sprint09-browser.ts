import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { encode } from "next-auth/jwt";
async function main() {
  const base = process.env.SPRINT09_PREVIEW_URL ?? "http://127.0.0.1:3000";
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))
    throw new Error("Local preview only");
  const m = JSON.parse(readFileSync("work/sprint09-preview.json", "utf8"));
  if (!m.synthetic) throw new Error("Synthetic data required");
  const { chromium } = require(
    process.env.PLAYWRIGHT_CORE_PATH ?? "playwright-core",
  );
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const folder =
    process.env.SPRINT09_SCREENSHOTS ?? "work/sprint09-screenshots";
  mkdirSync(folder, { recursive: true });
  let checks = 0;
  const ok = (v: unknown, msg: string) => {
    assert.ok(v, msg);
    checks++;
  };
  async function setup(width: number) {
    const ctx = await browser.newContext({
      viewport: { width, height: width === 1440 ? 1000 : 844 },
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
    const dialog = p.locator('[aria-labelledby="push-onboarding-title"]');
    await p.addLocatorHandler(dialog, async () => {
      await dialog
        .getByRole("button", { name: "Not now", exact: true })
        .click();
    });
    return { ctx, p };
  }
  async function dismissPrompt(p: any) {
    const dialog = p.locator('[aria-labelledby="push-onboarding-title"]');
    await p.removeLocatorHandler(dialog);
    if (await dialog.isVisible())
      await dialog
        .getByRole("button", { name: "Not now", exact: true })
        .click();
    await p.addLocatorHandler(dialog, async () => {
      await dialog
        .getByRole("button", { name: "Not now", exact: true })
        .click();
    });
  }
  async function layout(p: any) {
    const d = await p.evaluate(() => ({
      w: innerWidth,
      s: document.documentElement.scrollWidth,
    }));
    ok(d.s <= d.w, `No overflow ${JSON.stringify(d)}`);
  }
  async function visit(p: any, path: string) {
    const r = await p.goto(base + path, { waitUntil: "networkidle" });
    ok(r.status() === 200, `HTTP 200 ${path}`);
    const reject = p.getByRole("button", { name: "Reject", exact: true });
    if (await reject.isVisible()) await reject.click();
    const close = p.getByRole("button", { name: "Close ad", exact: true });
    if (await close.isVisible()) await close.click();
    await dismissPrompt(p);
    await layout(p);
  }
  async function shot(p: any, name: string, selector?: string) {
    if (selector)
      await p
        .locator(selector)
        .evaluate((e: HTMLElement) => e.scrollIntoView({ block: "start" }));
    await dismissPrompt(p);
    ok(
      !(await p
        .locator('[aria-labelledby="push-onboarding-title"]')
        .isVisible()),
      "Screenshot is not covered by onboarding",
    );
    await p.evaluate(() => {
      let label = document.getElementById("synthetic-preview-label");
      if (!label) {
        label = document.createElement("div");
        label.id = "synthetic-preview-label";
        document.body.appendChild(label);
      }
      label.textContent = "SYNTHETIC LOCAL PREVIEW · test records";
      label.style.cssText =
        "position:fixed;bottom:8px;right:8px;max-width:calc(100% - 16px);padding:5px 8px;font:10px sans-serif;z-index:2147483647;pointer-events:none;background:#101820;border:1px solid #384451;color:#d5e2e8;border-radius:6px";
    });
    await p.screenshot({
      path: `${folder}/${name}.png`,
      animations: "disabled",
    });
  }
  try {
    for (const width of [1440, 390, 320]) {
      const { ctx, p } = await setup(width);
      await visit(p, "/track-record");
      const html = await p.content();
      ok(
        !html.includes("PRIVATE_S09"),
        "No private selection in public HTML/flight",
      );
      ok(
        html.includes("Score-verified win rate"),
        "Explicit verification scope",
      );
      ok(
        (
          await p.locator('link[rel="canonical"]').getAttribute("href")
        ).endsWith("/track-record"),
        "Stable canonical",
      );
      for (const raw of await p
        .locator('script[type="application/ld+json"]')
        .allTextContents()) {
        JSON.parse(raw);
        ok(!raw.includes("PRIVATE_S09"), "Public structured data");
      }
      if (width !== 320) {
        await shot(p, `${width}-dashboard`);
        await shot(
          p,
          `${width}-breakdowns`,
          'section[aria-label="By primary category"]',
        );
        await shot(p, `${width}-history`, "#history");
      }
      const method = p.getByText("Calculation methods & evidence limits", {
        exact: true,
      });
      await method.click();
      await layout(p);
      ok(
        (await p.locator("body").innerText()).includes(
          "Partial returns are excluded",
        ),
        "Partial-return limits disclosed",
      );
      if (width !== 320)
        await shot(p, `${width}-methodology`, "#indicative-returns");
      await visit(p, `/track-record/prediction/${m.publicId}`);
      ok(
        (await p.locator("body").innerText()).includes(
          "Recorded published selection",
        ),
        "Stored selection labeled",
      );
      await p
        .getByText("Publication evidence & version history", { exact: true })
        .click();
      ok(
        (await p.locator("body").innerText()).includes("not available"),
        "Version limits explicit",
      );
      if (width !== 320) await shot(p, `${width}-record`);
      const denied = await p.goto(
        `${base}/track-record/prediction/${m.privateId}`,
        { waitUntil: "networkidle" },
      );
      ok(denied.status() === 404, "Unentitled record returns 404");
      ok(!(await p.content()).includes("PRIVATE_S09"), "404 payload safe");
      await visit(p, `/track-record/prediction/${m.missingId}`);
      ok(
        (await p.locator("body").innerText()).includes("Unavailable"),
        "Missing price explicit",
      );
      await p
        .getByText("Publication evidence & version history", { exact: true })
        .click();
      if (width !== 320) await shot(p, `${width}-missing-price`);
      await visit(p, "/track-record?team=NO_SYNTHETIC_MATCH");
      ok(
        (await p.locator("body").innerText()).includes(
          "No published records match",
        ),
        "Empty filter",
      );
      ok(
        (
          await p.locator('meta[name="robots"]').getAttribute("content")
        ).includes("noindex"),
        "Filtered states noindex",
      );
      if (width !== 320) await shot(p, `${width}-empty`);
      await visit(p, "/track-record?team=Synthetic%20History%20Home%2042");
      ok(
        (await p.locator("body").innerText()).includes(
          "Insufficient qualifying price evidence",
        ),
        "Insufficient sample",
      );
      if (width !== 320) await shot(p, `${width}-insufficient`);
      await visit(p, "/track-record");
      await p
        .getByRole("textbox", { name: "Team", exact: true })
        .fill("Synthetic History Home 4");
      await Promise.all([
        p.waitForURL(
          (u: URL) => u.searchParams.get("team") === "Synthetic History Home 4",
        ),
        p.getByRole("button", { name: "Search", exact: true }).click(),
      ]);
      ok(p.url().includes("team="), "Shareable GET search");
      await layout(p);
      await ctx.close();
    }
    const { ctx, p } = await setup(390);
    const token = await encode({
      secret: process.env.NEXTAUTH_SECRET ?? "sprint09-local-preview-only",
      maxAge: 3600,
      token: {
        uid: m.userId,
        sub: m.userId,
        role: "USER",
        email: "sprint09-preview@example.invalid",
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
    await visit(p, `/track-record/prediction/${m.privateId}`);
    const privateResponse = await ctx.request.get(
      `${base}/track-record/prediction/${m.privateId}`,
    );
    ok(
      privateResponse.headers()["cache-control"]?.includes("no-store"),
      "Private record responses are not shared-cacheable",
    );
    ok(
      (await p.content()).includes("PRIVATE_S09_SELECTION"),
      "Entitled subscriber can inspect own accessible history",
    );
    ok(
      (await p.locator('meta[name="robots"]').getAttribute("content")).includes(
        "noindex",
      ),
      "Private history noindex",
    );
    await visit(p, "/track-record");
    ok(
      (await p.locator('meta[name="robots"]').getAttribute("content")).includes(
        "noindex",
      ),
      "Personal dashboard noindex",
    );
    await ctx.close();
    const stale = await setup(390);
    const expiredToken = await encode({
      secret: process.env.NEXTAUTH_SECRET ?? "sprint09-local-preview-only",
      maxAge: 3600,
      token: {
        uid: m.expiredUserId,
        sub: m.expiredUserId,
        role: "USER",
        tier: "PREMIUM",
        subStatus: "ACTIVE",
        email: "sprint09-expired@example.invalid",
      },
    });
    await stale.ctx.addCookies([
      {
        name: "next-auth.session-token",
        value: expiredToken,
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const denied = await stale.p.goto(
      `${base}/track-record/prediction/${m.privateId}`,
      { waitUntil: "networkidle" },
    );
    ok(
      denied.status() === 404,
      "Expired database subscription denies stale paid JWT",
    );
    ok(
      !(await stale.p.content()).includes("PRIVATE_S09"),
      "Expired HTML/flight safe",
    );
    await stale.ctx.close();
    console.log(
      `Sprint 09 browser: ${checks} assertions passed at 1440/390/320; 16 actual synthetic screenshots`,
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
