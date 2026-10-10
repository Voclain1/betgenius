import { readFileSync } from "node:fs";
import { preloaderShows, PRELOADER_SCRIPT, PRELOADER_SKIP, PRELOADER_MAX_MS } from "../src/lib/preloader";

let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

console.log("where the preloader shows:");
for (const p of ["/", "/predictions", "/predictions/match/arsenal-vs-chelsea-2026-10-10", "/track-record", "/standings", "/pricing"]) check(`shows on ${p}`, preloaderShows(p));
for (const p of ["/livescores", "/fixtures", "/login", "/register", "/forgot-password", "/reset-password", "/fixtures/extra"]) check(`skipped on ${p}`, !preloaderShows(p));
check("a skip is a path segment, not a prefix (/fixtures-guide still shows)", preloaderShows("/fixtures-guide"));

console.log("\nthe inline script agrees with preloaderShows:");
const run = (pathname: string) => {
  const attrs: Record<string, string> = {};
  const timers: (() => void)[] = [];
  const doc = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) }, readyState: "loading" };
  const win = { addEventListener: () => {} };
  new Function("document", "location", "window", "setTimeout", PRELOADER_SCRIPT)(doc, { pathname }, win, (fn: () => void) => timers.push(fn));
  return { attrs, timers };
};
for (const p of ["/", "/livescores", "/login", "/predictions/today", "/fixtures/x"]) {
  const { attrs } = run(p);
  check(`${p}: ${preloaderShows(p) ? "stays up until load" : "marked skip before paint"}`, preloaderShows(p) ? attrs["data-preloaded"] === undefined : attrs["data-preloaded"] === "skip");
}
{
  const { attrs, timers } = run("/");
  timers.forEach((t) => t());
  check("the safety timer always dismisses it, even if load never fires", attrs["data-preloaded"] === "1");
}
check("the cap is short", PRELOADER_MAX_MS <= 3000);
check("every skip path is absolute", PRELOADER_SKIP.every((p) => p.startsWith("/")));

console.log("\nwiring:");
const layout = readFileSync("src/app/(public)/layout.tsx", "utf8");
check("mounted on the public layout", layout.includes("<Preloader />"));
for (const f of ["src/app/admin/layout.tsx", "src/app/dashboard/layout.tsx"]) {
  try {
    check(`not on ${f}`, !readFileSync(f, "utf8").includes("Preloader"));
  } catch {
    /* no such layout */
  }
}
const css = readFileSync("src/app/globals.css", "utf8");
check("CSS hides it once marked", /:root\[data-preloaded\] \.bg-preloader/.test(css));
check("CSS hides it without JS (fallback animation)", /animation: bg-preloader-out[^;]*forwards/.test(css));
check("reduced motion stops the pulse", /prefers-reduced-motion: reduce[\s\S]*bg-preloader-mark \{ animation: none/.test(css));

if (failures) {
  console.error(`\n${failures} preloader check(s) failed`);
  process.exit(1);
}
console.log("\npreloader checks passed");
