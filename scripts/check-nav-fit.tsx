/**
 * Renders the real header (src/components/Nav.tsx) with the real stylesheet
 * and measures it in Chromium, signed out, signed in and as an admin, at every
 * width a reader is likely to have. Fails if the bar is wider than the screen.
 *
 * WHY A BROWSER. The bar is `flex justify-between` with no wrapping: the
 * items sit at their natural widths and, once those add up past the container,
 * the row pushes off the screen instead of reflowing. It has overflowed three
 * times. The last time, the old estimate (check-nav-width.ts, font metrics
 * read from Windows font files) skipped on every machine without them and
 * never counted the signed-in buttons, which were the widest part of the bar.
 *
 * WHAT IS MEASURED. renderToStaticMarkup of <Nav /> inside a SessionProvider
 * carrying each session, styled with globals.css run through the project's own
 * Tailwind config, so every class in the markup resolves as it does in
 * production. Text renders in whatever the machine's system-ui is (DejaVu Sans
 * on CI, wider than Segoe UI or San Francisco), and the bar must leave
 * MIN_SPARE_PX free on top, for the fonts it was not measured in.
 *
 * Browser: playwright or playwright-core, whichever resolves, launching
 * CHROME_PATH when set. Without one the check skips, unless REQUIRE_BROWSER=1
 * (CI sets it, so the check can never quietly stop running there).
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-nav-fit.tsx
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionProvider } from "next-auth/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { Nav } from "../src/components/Nav";

const WIDTHS = [768, 900, 1024, 1180, 1280, 1440, 1920];
const MIN_SPARE_PX = 16;

const expires = "2099-01-01T00:00:00.000Z";
const STATES = {
  "signed out": null,
  "signed in": { user: { name: "Reader", email: "reader@example.com", role: "USER", tier: "FREE" }, expires },
  admin: { user: { name: "Admin", email: "admin@example.com", role: "SUPER_ADMIN", tier: "FREE" }, expires },
} as const;

// SearchBox calls useRouter(); nothing navigates during a static render.
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop } as any;

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
      // try the next one
    }
  }
  return null;
}

async function main() {
  const chromium = loadBrowser();
  if (!chromium) {
    if (process.env.REQUIRE_BROWSER === "1") {
      console.error("FAIL  no playwright / playwright-core to drive a browser, and REQUIRE_BROWSER=1");
      process.exit(1);
    }
    console.log("SKIP  no playwright / playwright-core installed: the header cannot be measured here");
    return;
  }

  const root = join(__dirname, "..");
  const config = require(join(root, "tailwind.config.ts"));
  const css = (
    await postcss([tailwindcss({ ...(config.default ?? config), content: [join(root, "src/**/*.{ts,tsx}")] })]).process(
      readFileSync(join(root, "src/app/globals.css"), "utf8"),
      { from: join(root, "src/app/globals.css") },
    )
  ).css;

  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    for (const [state, session] of Object.entries(STATES)) {
      const markup = renderToStaticMarkup(
        <AppRouterContext.Provider value={router}>
          <SessionProvider session={session as any} refetchOnWindowFocus={false}>
            <Nav />
          </SessionProvider>
        </AppRouterContext.Provider>,
      );
      const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body>${markup}</body></html>`;
      console.log(`\n${state}:`);
      for (const width of WIDTHS) {
        const page = await browser.newPage({ viewport: { width, height: 400 } });
        // The brand images are not served here; their width and height
        // attributes still size them, which is all the layout needs.
        await page.route("**/*", (r: any) => r.abort());
        await page.setContent(html);
        const m = await page.evaluate(() => {
          const bar = document.querySelector("header > div") as HTMLElement;
          const cs = getComputedStyle(bar);
          const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
          const room = bar.clientWidth - pad;
          // Flex items shrink before they overflow, so their rendered widths
          // always "fit". The natural width is what the row asks for.
          bar.style.width = "max-content";
          bar.style.maxWidth = "none";
          const need = bar.getBoundingClientRect().width - pad;
          bar.style.width = bar.style.maxWidth = "";
          return { room, need, pageScroll: document.documentElement.scrollWidth };
        });
        const spare = Math.round(m.room - m.need);
        check(
          `${String(width).padStart(4)}px: fits with ${MIN_SPARE_PX}px to spare`,
          spare >= MIN_SPARE_PX && m.pageScroll <= width,
          `${spare}px spare${m.pageScroll > width ? `, page scrolls sideways to ${m.pageScroll}px` : ""}`,
        );
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nThe header fits at every width, in every sign-in state");
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
