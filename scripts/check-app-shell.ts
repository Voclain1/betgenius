/**
 * Asserts the app-shell chrome switch.
 *
 * Two things are checked here, and the first is the important one.
 *
 * 1. THE EMBEDDED DETECTION STILL WORKS. APP_SHELL_INIT_SCRIPT is built by
 *    stringifying isRunningStandalone and isTrustedWebActivity, which buys a
 *    single implementation shared with the install banner but costs a
 *    constraint: those functions must reference nothing outside themselves. A
 *    stringified function carries its source, not its closure, so the day
 *    someone hoists the display-mode list to a module constant, the script
 *    throws ReferenceError, the catch swallows it, and the app silently renders
 *    website chrome forever — with every unit test still green, because the
 *    function itself would be fine. So the script is EXECUTED here, against
 *    stand-in windows, and its output compared against the functions it was
 *    built from.
 *
 * 2. The tab set and the active-tab matching, which are pure data and pure
 *    logic precisely so they can be asserted without a browser.
 *
 * Run: npx tsx scripts/check-app-shell.ts
 */
import { APP_SHELL_ATTR, APP_SHELL_INIT_SCRIPT, APP_TABS, STANDALONE_ATTR, activeTab } from "../src/lib/appShell";
import { isRunningStandalone, isTrustedWebActivity } from "../src/lib/installPrompt";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, Object.is(actual, expected), Object.is(actual, expected) ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

/**
 * Runs APP_SHELL_INIT_SCRIPT the way a browser would, with a fake document and
 * window, and reports the attributes it set. No jsdom: the script touches
 * exactly two globals, and hand-building them keeps this dependency-free and
 * makes the surface it is allowed to touch explicit.
 */
function runInitScript(opts: { modes?: string[]; iosStandalone?: boolean; referrer?: string; noMatchMedia?: boolean }) {
  const attrs: Record<string, string> = {};
  const documentElement = {
    setAttribute: (k: string, v: string) => {
      attrs[k] = v;
    },
  };
  const document = { documentElement, referrer: opts.referrer ?? "" };
  const window = {
    ...(opts.noMatchMedia ? {} : { matchMedia: (q: string) => ({ matches: (opts.modes ?? []).some((m) => q.includes(m)) }) }),
    navigator: opts.iosStandalone === undefined ? {} : { standalone: opts.iosStandalone },
    document,
  };
  // Indirect eval in a function whose only free variables are the two we pass.
  // A throw here is a real failure, not something to swallow — the script's own
  // try/catch is for production robustness, and catching it here too would hide
  // exactly the drift this test exists to find.
  new Function("window", "document", APP_SHELL_INIT_SCRIPT)(window, document);
  return attrs;
}

console.log("embedded detection — the init script must behave identically to the functions it was built from:");
{
  // Any free identifier in either stringified function surfaces here as a
  // ReferenceError rather than as a wrong answer.
  let threw = "";
  try {
    runInitScript({ modes: ["browser"] });
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  check("script executes without a ReferenceError (functions are self-contained)", threw === "", threw);
}

const cases: { label: string; opts: Parameters<typeof runInitScript>[0] }[] = [
  { label: "browser tab", opts: { modes: ["browser"] } },
  { label: "display-mode: standalone", opts: { modes: ["standalone"] } },
  { label: "display-mode: minimal-ui", opts: { modes: ["minimal-ui"] } },
  { label: "display-mode: fullscreen", opts: { modes: ["fullscreen"] } },
  { label: "iOS navigator.standalone", opts: { iosStandalone: true, modes: [] } },
  { label: "iOS Safari tab (standalone false)", opts: { iosStandalone: false, modes: [] } },
  { label: "window without matchMedia", opts: { noMatchMedia: true } },
];

for (const { label, opts } of cases) {
  const attrs = runInitScript(opts);
  const scriptSaysInstalled = attrs[STANDALONE_ATTR] === "true";
  // The stand-in the pure function sees, built the same way the script's is.
  const fnSaysInstalled = isRunningStandalone({
    ...(opts.noMatchMedia ? {} : { matchMedia: (q: string) => ({ matches: (opts.modes ?? []).some((m) => q.includes(m)) }) }),
    navigator: opts.iosStandalone === undefined ? {} : { standalone: opts.iosStandalone },
  });
  eq(`${label}: script agrees with isRunningStandalone`, scriptSaysInstalled, fnSaysInstalled);
}

console.log("\nbrowser tabs must be left completely untouched — no attribute, no chrome switch:");
eq("browser tab sets no standalone attribute", runInitScript({ modes: ["browser"] })[STANDALONE_ATTR], undefined);
eq("browser tab sets no app-shell attribute", runInitScript({ modes: ["browser"] })[APP_SHELL_ATTR], undefined);
// A TWA referrer without a standalone display mode is not an installed app —
// the referrer alone must never be able to flip the chrome.
eq(
  "android-app referrer in a browser tab does not flip the chrome",
  runInitScript({ modes: ["browser"], referrer: "android-app://ng.betgenius.twa" })[STANDALONE_ATTR],
  undefined,
);

console.log("\nTWA vs PWA — distinguished, and both get the same chrome:");
eq("TWA is labelled twa", runInitScript({ modes: ["standalone"], referrer: "android-app://ng.betgenius.twa" })[APP_SHELL_ATTR], "twa");
eq("home-screen PWA is labelled pwa", runInitScript({ modes: ["standalone"], referrer: "" })[APP_SHELL_ATTR], "pwa");
eq("iOS installed PWA is labelled pwa", runInitScript({ iosStandalone: true, modes: [] })[APP_SHELL_ATTR], "pwa");
eq(
  "both are standalone — the chrome does not fork on packaging",
  runInitScript({ modes: ["standalone"], referrer: "android-app://x" })[STANDALONE_ATTR],
  runInitScript({ modes: ["standalone"] })[STANDALONE_ATTR],
);
eq("isTrustedWebActivity rejects an http referrer", isTrustedWebActivity({ referrer: "https://google.com" }), false);
eq("isTrustedWebActivity accepts an android-app referrer", isTrustedWebActivity({ referrer: "android-app://ng.betgenius" }), true);
eq("isTrustedWebActivity handles a missing referrer", isTrustedWebActivity({}), false);

console.log("\ntab set — five tabs, all pointing at routes that exist:");
eq("five tabs", APP_TABS.length, 5);
eq("labels", APP_TABS.map((t) => t.label).join(","), "Tips,Live,Fixtures,Builder,Account");
{
  // Every tab href must resolve to a real page, so a renamed route cannot
  // leave a dead tab shipping in the installed app. Static directories are
  // checked directly; /predictions/today is served by the dynamic [category]
  // segment, so it resolves against that and against the slug table the route
  // actually accepts — a tab pointing at a category that CATEGORY_SLUGS does
  // not know would 404 just as surely as a missing directory.
  const root = join(__dirname, "..", "src", "app", "(public)");
  const hasPage = (segments: string) => {
    try {
      readFileSync(join(root, segments, "page.tsx"));
      return true;
    } catch {
      return false;
    }
  };
  for (const tab of APP_TABS) {
    if (tab.href === "/dashboard") continue; // outside (public) — its own tree
    if (tab.href.startsWith("/predictions/")) {
      const slug = tab.href.slice("/predictions/".length);
      const dynamic = hasPage(join("predictions", "[category]"));
      // CATEGORY_SLUGS is read as SOURCE TEXT rather than imported:
      // categoryPredictions.ts pulls in React's cache() and the Prisma client,
      // neither of which loads outside a Next runtime, and this assertion is
      // about one object literal in that file.
      const slugTable = readFileSync(join(__dirname, "..", "src", "lib", "categoryPredictions.ts"), "utf8");
      const table = slugTable.slice(slugTable.indexOf("CATEGORY_SLUGS"), slugTable.indexOf("CATEGORY_NAMES"));
      const known = new RegExp(`["']?${slug}["']?\s*:`).test(table);
      check(`${tab.label} -> ${tab.href} resolves via [category]`, dynamic && known, dynamic ? `"${slug}" not in CATEGORY_SLUGS` : "no [category] route");
      continue;
    }
    check(`${tab.label} -> ${tab.href} has a page`, hasPage(tab.href));
  }
}

console.log("\ntips tab destination — the section index, not a category inside it:");
eq("Tips points at the /predictions index", APP_TABS.find((t) => t.label === "Tips")?.href, "/predictions");
// The destination must be a page the tab also LIGHTS UP for. A tab whose own
// target does not activate it would render un-highlighted the instant it was
// tapped, which is the specific bug this pairing guards against.
eq("tapping Tips lands on a page that lights Tips", activeTab(APP_TABS.find((t) => t.label === "Tips")!.href)?.label, "Tips");
// BackButton.ts treats tab destinations as roots — a back button on the page a
// tab just landed you on would either no-op or leave the site.
{
  const back = readFileSync(join(__dirname, "..", "src", "components", "BackButton.tsx"), "utf8");
  const roots = back.slice(back.indexOf("ROOT_PATHS"), back.indexOf("function normalize"));
  for (const tab of APP_TABS) {
    check(`${tab.label} destination ${tab.href} is a BackButton ROOT_PATH`, roots.includes(`"${tab.href}"`));
  }
}

console.log("\nactive tab — longest prefix wins, and no tab claims a page it does not own:");
eq("the predictions index", activeTab("/predictions")?.label, "Tips");
eq("tips feed", activeTab("/predictions/today")?.label, "Tips");
// Every category sub-page keeps Tips lit — the tab is the SECTION, so browsing
// from the index into any one category must not drop the highlight.
for (const c of ["today", "genius", "featured", "banker", "combo-bets", "vip", "premium", "bet-of-the-day"]) {
  eq(`/predictions/${c} lights Tips`, activeTab(`/predictions/${c}`)?.label, "Tips");
}
eq("a match page lights Tips", activeTab("/predictions/match/arsenal-vs-chelsea-2026-01-01")?.label, "Tips");
eq("a league page lights Tips", activeTab("/predictions/league/la-liga-140")?.label, "Tips");
eq("a team page lights Tips", activeTab("/predictions/team/arsenal")?.label, "Tips");
eq("an h2h page lights Tips", activeTab("/predictions/h2h/arsenal-vs-chelsea")?.label, "Tips");
eq("the predictions index with a trailing slash", activeTab("/predictions/")?.label, "Tips");
eq("livescores", activeTab("/livescores")?.label, "Live");
eq("fixtures", activeTab("/fixtures")?.label, "Fixtures");
eq("bet builder", activeTab("/bet-builder")?.label, "Builder");
eq("dashboard lights Account", activeTab("/dashboard")?.label, "Account");
eq("login lights Account", activeTab("/login")?.label, "Account");
eq("pricing lights Account", activeTab("/pricing")?.label, "Account");
eq("trailing slash is tolerated", activeTab("/livescores/")?.label, "Live");
// Null is a real answer, not a fallback: highlighting a tab on a page that is
// not in that section tells the reader they are somewhere they are not.
eq("the homepage lights nothing", activeTab("/"), null);
eq("standings lights nothing", activeTab("/standings"), null);
eq("statspad lights nothing", activeTab("/statspad"), null);
eq("the cookie policy lights nothing", activeTab("/cookie-policy"), null);
eq("track-record lights nothing (deliberately not a tab)", activeTab("/track-record"), null);
// Segment-boundary matching, not bare startsWith.
eq("a sibling route with a shared prefix does not light Fixtures", activeTab("/fixtures-archive"), null);

console.log("\nlayout clearance — the body padding must match the bar's own height:");
{
  const css = readFileSync(join(__dirname, "..", "src", "app", "globals.css"), "utf8");
  const bar = readFileSync(join(__dirname, "..", "src", "components", "AppTabBar.tsx"), "utf8");
  // The bar is h-14 (3.5rem); the clearance rule must use the same number, or
  // the tab bar covers the last of the page.
  // The class sits in a template literal (the active/inactive colour is
  // interpolated), so this looks for the utility itself rather than for a
  // quoted className attribute.
  check("AppTabBar is h-14", /\bh-14\b/.test(bar));
  check("body clearance is calc(3.5rem + safe-area)", css.includes("padding-bottom: calc(3.5rem + env(safe-area-inset-bottom))"));
  check("both pad for the safe-area inset", bar.includes("env(safe-area-inset-bottom)"));
}

console.log(failures === 0 ? "\nAll app-shell checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
