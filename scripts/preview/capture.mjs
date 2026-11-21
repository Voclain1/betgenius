/**
 * Screenshot-only reviewer artifacts from an isolated SSH tunnel to the staging
 * app. Never signs in, calls admin actions or submits any form.
 */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const origin = "http://127.0.0.1:3101";
const out = "preview-artifacts";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});

const failures = [];
try {
  for (const target of [
    { name: "home-mobile", path: "/", width: 390, height: 844 },
    { name: "today-mobile", path: "/predictions/today", width: 390, height: 844 },
    { name: "vip-mobile", path: "/predictions/vip", width: 390, height: 844 },
    { name: "home-desktop", path: "/", width: 1440, height: 900 },
    { name: "today-desktop", path: "/predictions/today", width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: target.width, height: target.height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    const page = await context.newPage();
    try {
      const res = await page.goto(origin + target.path, { waitUntil: "domcontentloaded", timeout: 35_000 });
      if (!res || res.status() !== 200) throw new Error("HTTP " + (res?.status() ?? "none"));
      await page.locator("main").waitFor({ state: "visible", timeout: 15_000 });
      await page.screenshot({ path: out + "/" + target.name + ".png", fullPage: true, animations: "disabled" });
      const metrics = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
      if (metrics.width > metrics.viewport + 5) failures.push(target.name + " horizontal overflow: " + JSON.stringify(metrics));
      console.log("CAPTURE_OK=" + target.name);
    } catch (e) {
      failures.push(target.name + ": " + String(e));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
for (const f of failures) console.error("PREVIEW_VISUAL_WARNING=" + f);
if (failures.length) process.exitCode = 1;
