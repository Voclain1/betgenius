/**
 * Asserts the rules that govern where Adsterra units may appear and how they
 * are loaded.
 *
 * WHY THIS EXISTS. Three of the constraints on this integration are invisible
 * at the call site and fail silently in production if broken:
 *
 *  1. THE AD-FREE ROUTES. /responsible-gambling, /terms, /track-record and the
 *     rest are ad-free for credibility, and /bet-builder, /multi-bets and
 *     /bookmakers are ad-free because they carry real affiliate "Join" buttons
 *     that an ad creative must never sit beside. Nothing in the type system
 *     stops someone adding a band to one of them, and nobody reviewing a diff
 *     to a layout file necessarily knows which pages sit under it.
 *  2. THE `atOptions` GLOBAL. Every banner is configured by assigning to one
 *     bare global that invoke.js reads on load, so two units sharing a
 *     document render as two copies of whichever assignment ran last. The only
 *     thing preventing that is that AdFrame loads each unit in its own iframe,
 *     served by /ads/frame. A "simplification" that inlines a tag back into
 *     the page reintroduces the bug, and it shows up as wrong creatives on a
 *     live site, not as a failing build. The frame also has to keep loading
 *     from a src rather than a srcdoc — see the route file for why.
 *  3. THE RESERVED BOX. Each slot paints a box the exact size of its creative
 *     before anything loads, which is what keeps these units at zero CLS. If
 *     the box and the `atOptions` size ever come from different numbers, the
 *     unit starts shifting the page and no test would notice.
 *
 *  4. ADS REACHING AN AD-FREE ROUTE THROUGH A SHARED COMPONENT. Feeds now
 *     carry ads BETWEEN groups of picks, which means the ad import lives in
 *     CategoryPredictionsList — a component the ad-free account dashboard
 *     also renders. Checking each route's own files would see nothing wrong.
 *     So the import graph is walked, and a component that can render ads is
 *     only allowed to reach an ad-free route if the ads are opt-in and that
 *     route does not opt in.
 *
 * WHAT IT DOES NOT CHECK. The editorial rule — an ad is always its own full
 * block, never inside or overlapping a single prediction card — is a
 * judgement about what a block contains, not something derivable from the
 * source. It is stated in AdPlacements.tsx and enforced in review, and the
 * rendered result is checked in a browser.
 *
 * Run: npx tsx scripts/check-ad-placement.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { AD_UNITS, AD_FREE_ROUTES, invokeUrl, feedAdPositions, FEED_AD_INTERVAL, FEED_AD_MAX, FEED_AD_MIN_TAIL } from "../src/lib/ads";

const ROOT = join(__dirname, "..");
const APP = join(ROOT, "src", "app");
const ADS_DIR = join(ROOT, "src", "components", "ads");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

// ---------------------------------------------------------------------------
// The route tree
// ---------------------------------------------------------------------------

/**
 * Every page.tsx under src/app, with the URL path it serves and every file
 * that renders into it.
 *
 * Layouts are collected on the way down and carried into each descendant's
 * file list. That is the point of doing this as a walk rather than a glob: an
 * ad imported into src/app/(public)/layout.tsx would put a band on every
 * public page including the legal ones, and checking page.tsx alone would
 * never see it.
 *
 * Route groups — "(public)" — are organisational and contribute no path
 * segment. Dynamic segments keep their brackets; they are only ever compared
 * by prefix below.
 */
function routes(): { route: string; files: string[] }[] {
  const out: { route: string; files: string[] }[] = [];

  const walk = (dir: string, path: string, inherited: string[]): void => {
    const entries = readdirSync(dir);
    const here = entries.includes("layout.tsx") ? [...inherited, join(dir, "layout.tsx")] : inherited;
    if (entries.includes("page.tsx")) out.push({ route: path || "/", files: [...here, join(dir, "page.tsx")] });
    for (const entry of entries) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      walk(full, entry.startsWith("(") ? path : `${path}/${entry}`, here);
    }
  };

  walk(APP, "", []);
  return out;
}

const allRoutes = routes();
check("route tree walked", allRoutes.length > 10, `${allRoutes.length} routes`);

/**
 * Trees that are ad-free for reasons beyond the reader-facing AD_FREE_ROUTES
 * list: the admin console and the signed-in dashboard are product surfaces,
 * not reader surfaces, and neither should carry third-party JavaScript.
 */
const AD_FREE_TREES = ["/admin", "/dashboard"];

// ---------------------------------------------------------------------------
// Reading source
// ---------------------------------------------------------------------------

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(e) ? [full] : [];
  });
}

/**
 * Source with comments removed.
 *
 * Every assertion here is about what the code DOES, and both this file and the
 * files it inspects discuss `atOptions` and `allow-same-origin` at length in
 * prose. Matching raw text would fail on the documentation that exists to
 * explain the rule, so the prose is stripped and only real code is searched.
 *
 * A hand-written scanner rather than a pair of regexes, because a regex that
 * removes comments also removes anything comment-shaped inside a string — and
 * the "//" in every URL in this codebase is exactly that. This tracks quotes
 * and template literals, so a URL inside a string survives and a URL inside a
 * comment does not.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (quote) {
      if (c === "\\") {
        out += c + (next ?? "");
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }

    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

const src = sources(join(ROOT, "src"));
const rel = (f: string) => relative(ROOT, f).split(sep).join("/");

/**
 * Components that can render ads but only when a caller asks, keyed by the
 * prop that asks. A shared component is allowed to reach an ad-free route ONLY
 * through one of these, and only if that route never passes the prop.
 */
const OPT_IN: Record<string, string> = {
  "src/components/CategoryPredictionsList.tsx": "withAds",
};

/** Resolved local imports of a file — "@/..." and relative alike. */
function importsOf(file: string): string[] {
  const out: string[] = [];
  for (const m of code(file).matchAll(/from "(@\/[^"]+|\.\.?\/[^"]+)"/g)) {
    const spec = m[1];
    const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : resolve(dirname(file), spec);
    for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        out.push(candidate);
        break;
      }
    }
  }
  return out;
}

/**
 * Every import chain from `entries` that ends in an ad component, as file
 * paths. Depth-first with a shared visited set: this answers "can ads be
 * reached from here", not "how many ways", which is all the rule needs.
 */
function adReachingPaths(entries: string[]): string[][] {
  const seen = new Set<string>();
  const hits: string[][] = [];
  const stack: { file: string; path: string[] }[] = entries.map((f) => ({ file: f, path: [f] }));
  while (stack.length) {
    const { file, path } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.startsWith(ADS_DIR)) {
      hits.push(path);
      continue;
    }
    for (const dep of importsOf(file)) stack.push({ file: dep, path: [...path, dep] });
  }
  return hits;
}
const code = (file: string) => stripComments(readFileSync(file, "utf8"));
const frameSource = code(join(ADS_DIR, "AdUnit.tsx"));
const routeSource = code(join(APP, "ads", "frame", "route.ts"));
const libSource = code(join(ROOT, "src", "lib", "ads.ts"));
const middlewareSource = code(join(ROOT, "src", "middleware.ts"));

// ---------------------------------------------------------------------------
// 1. Ad-free routes
// ---------------------------------------------------------------------------

console.log("\nAd-free routes");

const importsAds = (file: string) => /from "@\/components\/ads\//.test(code(file));

for (const prefix of [...AD_FREE_ROUTES, ...AD_FREE_TREES]) {
  const matched = allRoutes.filter((r) => r.route === prefix || r.route.startsWith(`${prefix}/`));
  // A prefix matching nothing is itself a failure: it means a route was
  // renamed or removed and the list now protects a page that does not exist,
  // which reads as coverage while providing none.
  if (matched.length === 0) {
    check(`${prefix} exists`, false, "no route matches — stale entry in AD_FREE_ROUTES?");
    continue;
  }
  const dirty = matched.filter((r) => r.files.some(importsAds));
  check(
    `${prefix} imports no ads directly`,
    dirty.length === 0,
    dirty.length ? dirty.map((d) => d.route).join(", ") : `${matched.length} route(s)`,
  );

  // And the same question asked of everything those routes pull in.
  for (const route of matched) {
    const paths = adReachingPaths(route.files);
    if (paths.length === 0) continue;
    for (const path of paths) {
      const gate = path.map(rel).find((f) => f in OPT_IN);
      if (!gate) {
        check(`${route.route} reaches ads only via an opt-in`, false, path.map(rel).join(" -> "));
        continue;
      }
      // The gate exists; the route must not be pulling the trigger.
      const prop = OPT_IN[gate];
      const opted = route.files.filter((f) => new RegExp(`\\b${prop}\\b`).test(code(f)));
      check(
        `${route.route} does not pass ${prop}`,
        opted.length === 0,
        opted.length ? opted.map(rel).join(", ") : `gated behind ${gate.split("/").pop()}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Isolation
// ---------------------------------------------------------------------------

console.log("\nIsolation");

const withAtOptions = src.filter((f) => code(f).includes("atOptions"));
check(
  "atOptions appears only in the frame route",
  withAtOptions.length === 1 && rel(withAtOptions[0]) === "src/app/ads/frame/route.ts",
  withAtOptions.map(rel).join(", ") || "nowhere — the frame document lost its config",
);

// THE INVARIANT INVERTED HERE ON PURPOSE, AND THE REASON MATTERS.
//
// This used to assert that the frame is sandboxed WITHOUT allow-same-origin.
// That was measured against the live site and found to serve zero ads: on an
// opaque origin invoke.js loads, returns 200 and then makes no request to the
// ad server at all. Every slot was an empty box for as long as it shipped.
//
// The fix is not to grant the flag on our own origin — that hands the ad
// script our cookies and DOM — but to serve the frame from another hostname,
// where allow-same-origin means "keep your own origin" and the Same Origin
// Policy does the isolating. So what has to be guarded now is the COUPLING:
// the flag may only ever appear together with a configured separate origin.
check(
  "the base sandbox grants no origin of its own",
  frameSource.includes('const BASE_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox"'),
);
check(
  "allow-same-origin is granted only when the frame is cross-origin",
  frameSource.includes("crossOrigin ? `${BASE_SANDBOX} allow-same-origin` : BASE_SANDBOX") &&
    frameSource.includes("sandboxFor(adsAreCrossOrigin())"),
  "same origin + allow-same-origin + allow-scripts is the combination to avoid",
);
check(
  "a missing ads origin fails safe",
  libSource.includes("adsAreCrossOrigin = () => ADS_ORIGIN.length > 0"),
  "an unset NEXT_PUBLIC_ADS_ORIGIN must degrade to no fill, never to same-origin ads",
);
check(
  "the frame src is built from the ads origin",
  frameSource.includes("src={adFrameSrc(unit.id)}") && libSource.includes("`${ADS_ORIGIN}/ads/frame?unit="),
);
check(
  "the ads hostname serves only /ads/",
  middlewareSource.includes("ADS_HOST") &&
    middlewareSource.includes('req.nextUrl.pathname.startsWith("/ads/")') &&
    middlewareSource.includes("status: 404"),
  "without this the whole site answers on the ads hostname too",
);
check(
  "widening the matcher did not put the site behind a login",
  middlewareSource.includes("PROTECTED.test(req.nextUrl.pathname)") &&
    middlewareSource.includes("/^\\/(admin|dashboard)(\\/|$)/"),
  "auth must be invoked for those two trees only, not for every matched path",
);

// The frame loads from OUR route, never straight from the network: the
// document around the two script tags has to be one we author. And it must
// be a src rather than a srcdoc — a srcdoc document on an opaque origin
// never issues the script request at all, which is the silent zero-fill
// this design exists to avoid. The measurements are in the route file.
check("frames load from the /ads/frame route", libSource.includes("/ads/frame?unit="));
check("no frame uses srcDoc", !frameSource.includes("srcDoc"));

// Pages go through the placements, so the label, the band chrome and the
// breakpoint pairing cannot be bypassed by importing the raw frame.
const rawImporters = src
  .filter((f) => !f.startsWith(ADS_DIR))
  .filter((f) => /from "@\/components\/ads\/AdUnit"/.test(code(f)));
check("nothing imports AdUnit directly", rawImporters.length === 0, rawImporters.map(rel).join(", "));

// ---------------------------------------------------------------------------
// 3. The inventory
// ---------------------------------------------------------------------------

console.log("\nInventory");

const units = Object.values(AD_UNITS);
const identifiers = units.map((u) => ("key" in u ? u.key : u.containerId));
check("no unit is configured twice", new Set(identifiers).size === identifiers.length);

for (const unit of units) {
  if (unit.kind !== "iframe") continue;
  check(`${unit.id} carries a 32-character Adsterra key`, /^[0-9a-f]{32}$/.test(unit.key), unit.key);
  check(`${unit.id} invoke URL derives from its key`, invokeUrl(unit.key).endsWith(`/${unit.key}/invoke.js`));
}

// The reserved box and the atOptions config must both read AD_UNITS, so a size
// can only go wrong in one place if someone writes a literal.
check(
  "the atOptions size comes from the unit record",
  routeSource.includes("height: unit.height") && routeSource.includes("width: unit.width"),
);
check(
  "the reserved box is sized from the same record",
  frameSource.includes("style={{ width, height }}") && frameSource.includes("? unit.width"),
);

// Every unit that exists should be on the site somewhere — an unplaced unit is
// inventory that was configured and then forgotten.
const placements = code(join(ADS_DIR, "AdPlacements.tsx"));
for (const unit of units) {
  const placed =
    placements.includes(`AD_UNITS.${unit.id}`) ||
    placements.includes(`"${unit.id}"`) ||
    (unit.kind === "native" && placements.includes("NativeAd"));
  check(`${unit.id} is placed somewhere`, placed);
}

// ---------------------------------------------------------------------------
// 4. In-feed insertion points
// ---------------------------------------------------------------------------

console.log("\nIn-feed positions");

const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

// The three rules from feedAdPositions, each pinned by the case that would
// break if it were dropped.
eq("a feed too short to interrupt gets nothing", feedAdPositions(5), []);
eq("no insertion that strands fewer than three picks", feedAdPositions(8), []);
eq("the first insertion lands at the interval", feedAdPositions(9), [FEED_AD_INTERVAL]);
eq("a mid-length feed gets two", feedAdPositions(20), [6, 12]);
eq("a long feed is capped, not filled", feedAdPositions(95), [6, 12, 18]);
check("the cap is what bounds a long feed", feedAdPositions(95).length === FEED_AD_MAX);
check("positions are strictly increasing", feedAdPositions(95).every((p, i, a) => i === 0 || p > a[i - 1]));
check(
  "every position leaves the required tail",
  [9, 20, 32, 58, 95].every((n) => feedAdPositions(n).every((p) => n - p >= FEED_AD_MIN_TAIL)),
);

// And every placement should be rendered by a page — a band nobody uses is
// dead code that still reads as coverage.
console.log("\nPlacements in use");
for (const placement of ["AdLeaderboard", "AdHalfBanner", "AdRectangle", "AdNativeBand", "WithAdRail"]) {
  const users = src.filter((f) => f.startsWith(APP)).filter((f) => new RegExp(`\\b${placement}\\b`).test(code(f)));
  check(`${placement} is used`, users.length > 0, `${users.length} page(s)`);
}
// Rendered by the feed component rather than by a page, so it is looked for
// across all of src rather than under app/.
{
  const users = src.filter((f) => !f.startsWith(ADS_DIR)).filter((f) => /\bAdInFeed\b/.test(code(f)));
  check("AdInFeed is used", users.length > 0, users.map(rel).join(", "));
}

console.log(`\n${failures === 0 ? "OK" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
