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
 * WHAT IT DOES NOT CHECK. The central editorial rule — an ad never appears
 * above the first pick on a page and never inside a list of picks — is a
 * judgement about what a section contains, not something derivable from the
 * source. It is stated in AdPlacements.tsx and enforced in review.
 *
 * Run: npx tsx scripts/check-ad-placement.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { AD_UNITS, AD_FREE_ROUTES, invokeUrl } from "../src/lib/ads";

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
const code = (file: string) => stripComments(readFileSync(file, "utf8"));
const frameSource = code(join(ADS_DIR, "AdUnit.tsx"));
const routeSource = code(join(APP, "ads", "frame", "route.ts"));

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
    `${prefix} is ad-free`,
    dirty.length === 0,
    dirty.length ? dirty.map((d) => d.route).join(", ") : `${matched.length} route(s)`,
  );
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

check(
  "frames are sandboxed without allow-same-origin",
  frameSource.includes('const SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox"') &&
    !frameSource.includes("allow-same-origin"),
  "a frame sharing our origin can read our cookies and our DOM",
);

// The frame loads from OUR route, never straight from the network: the
// document around the two script tags has to be one we author. And it must
// be a src rather than a srcdoc — a srcdoc document on an opaque origin
// never issues the script request at all, which is the silent zero-fill
// this design exists to avoid. The measurements are in the route file.
check("frames load from the /ads/frame route", frameSource.includes("/ads/frame?unit="));
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

// And every placement should be rendered by a page — a band nobody uses is
// dead code that still reads as coverage.
console.log("\nPlacements in use");
for (const placement of ["AdLeaderboard", "AdHalfBanner", "AdRectangle", "AdNativeBand", "WithAdRail"]) {
  const users = src.filter((f) => f.startsWith(APP)).filter((f) => new RegExp(`\\b${placement}\\b`).test(code(f)));
  check(`${placement} is used`, users.length > 0, `${users.length} page(s)`);
}

console.log(`\n${failures === 0 ? "OK" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
