/**
 * Detailed / Compact prediction feeds, and the homepage category buttons.
 *
 * Renders CategoryPredictionsList and PredictionViewSwitch to static markup —
 * no browser, database or running app — and asserts:
 *
 *   1. TODAY is table-only whatever view is asked for.
 *   2. Every other category renders Detailed as the PredictionCard grid and
 *      Compact as PredictionsTable, with the same rows in the same order.
 *   3. Compact carries no reasoning, and a locked row stays locked — pick,
 *      confidence AND the Over/Under line, which is derived from the pick.
 *   4. In-feed ads land at the same positions in both views, and a caller that
 *      does not opt in (the dashboard) gets none in either.
 *   5. The switch server-renders Detailed with an accessible pressed state,
 *      and the stored preference reads, writes and fails safe to Detailed.
 *   6. The homepage buttons say "Tips" and include Goals before Multi Bets.
 *
 * Run with the JSX override the automatic runtime needs:
 *   npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-prediction-view.tsx
 */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
// Must precede the component imports: PredictionCard reaches
// src/lib/categoryPredictions.ts, which calls React's server-only cache() at
// module load. Nothing here queries — the shim only lets the module load.
import "./lib/reactCacheShim";
import { CategoryPredictionsList } from "../src/components/CategoryPredictionsList";
import { PredictionViewSwitch } from "../src/components/PredictionViewSwitch";
import {
  PREDICTION_VIEW_KEY,
  parsePredictionView,
  readPredictionView,
  writePredictionView,
} from "../src/lib/predictionView";
import { HOME_CATEGORY_LINKS } from "../src/lib/homeCategoryLinks";
import { feedAdPositions } from "../src/lib/ads";

let passed = 0;
const failures: string[] = [];
const check = (l: string, c: boolean, got?: unknown) => {
  if (c) passed++;
  else failures.push(`${l}${got === undefined ? "" : `\n      got: ${JSON.stringify(String(got).slice(0, 300))}`}`);
};

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const count = (s: string, needle: string | RegExp) =>
  typeof needle === "string" ? s.split(needle).length - 1 : (s.match(needle) ?? []).length;

const REASONING = "Reasoning-sentinel-text";

function rows(n: number, over: Record<string, unknown> = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    category: "GENIUS",
    market: "Match Winner",
    pick: `Pick-${i}`,
    overUnder: `Over-${i}.5`,
    confidence: 70 + (i % 20),
    reasoning: `${REASONING} ${i}`,
    leagueName: "Premier League",
    leagueApiId: 39,
    homeTeam: `Home${i}Side`,
    awayTeam: `Away${i}Side`,
    kickoff: "2026-09-29T15:00:00Z",
    ...over,
  }));
}

/** Home team names in the order they appear in the markup. */
const order = (s: string) => [...s.matchAll(/Home(\d+)Side/g)].map((m) => Number(m[1])).filter((v, i, a) => a.indexOf(v) === i);
const ADS = 'aria-label="Advertisement"';
const CARD = /<article\b/g;
const TABLE = /<table\b/g;

// ===========================================================================
// 1. TODAY is table-only
// ===========================================================================
for (const view of ["detailed", "compact"] as const) {
  const out = html(<CategoryPredictionsList category="TODAY" rows={rows(4) as any} view={view} />);
  check(`TODAY (${view} requested) renders the table`, count(out, TABLE) === 1, out);
  check(`TODAY (${view} requested) renders no cards`, count(out, CARD) === 0);
}
{
  const out = html(<CategoryPredictionsList category="TODAY" rows={rows(4) as any} />);
  check("TODAY with no view is the table", count(out, TABLE) === 1 && count(out, CARD) === 0);
}

// ===========================================================================
// 2 & 3. Non-TODAY: Detailed = cards, Compact = table, same rows, no reasoning
// ===========================================================================
for (const category of ["GENIUS", "BANKER", "VIP", "GOALS", "PREMIUM"] as const) {
  const detailed = html(<CategoryPredictionsList category={category} rows={rows(5) as any} view="detailed" />);
  const compact = html(<CategoryPredictionsList category={category} rows={rows(5) as any} view="compact" />);
  const byDefault = html(<CategoryPredictionsList category={category} rows={rows(5) as any} />);

  check(`${category} detailed uses PredictionCard`, count(detailed, CARD) === 5 && count(detailed, TABLE) === 0, detailed);
  check(`${category} detailed keeps reasoning`, count(detailed, REASONING) === 5);
  check(`${category} with no view is detailed`, byDefault === detailed);
  check(`${category} compact uses PredictionsTable`, count(compact, TABLE) === 1 && count(compact, CARD) === 0, compact);
  check(`${category} compact has no reasoning`, !compact.includes(REASONING));
  check(`${category} compact has one body row per pick`, count(compact, "<tr") === 1 + 5);
  check(`${category} compact shows pick, Over/Under and confidence`,
    compact.includes("Pick-3") && compact.includes("Over-3.5") && compact.includes("73%"));
  check(`${category} same row order in both views`, JSON.stringify(order(detailed)) === JSON.stringify(order(compact)),
    `${order(detailed)} vs ${order(compact)}`);
}

// Yesterday's result chips survive into Compact (PredictionsTable's Result column).
{
  const settled = rows(3).map((r, i) => ({ ...r, outcome: i === 0 ? "WON" : "LOST" }));
  const compact = html(<CategoryPredictionsList category="GENIUS" rows={settled as any} view="compact" />);
  check("compact shows the Result column on a settled day", compact.includes(">Result<") && compact.includes(">WON<"));
}

// Locked rows, shaped exactly as /predictions/[category] shapes them.
{
  const locked = rows(3).map((r) => ({
    ...r,
    pick: "LOCKED",
    reasoning: "Subscribe to VIP or Premium to unlock this tip and full reasoning.",
    confidence: null,
    odds: null,
    overUnder: null,
    locked: true,
  }));
  const compact = html(<CategoryPredictionsList category="VIP" rows={locked as any} view="compact" />);
  check("locked compact rows say LOCKED", count(compact, ">LOCKED<") === 3, compact);
  check("locked compact rows show no confidence", !/\d+%/.test(compact));
  check("locked compact rows carry no lock-reason prose", !compact.includes("Subscribe to VIP"));

  // Defence in depth: even if a caller forgets to null the line, the table masks it.
  const leaky = locked.map((r, i) => ({ ...r, overUnder: `Over-${i}.5` }));
  const masked = html(<CategoryPredictionsList category="GOALS" rows={leaky as any} view="compact" />);
  check("the table masks Over/Under on a locked row", !masked.includes("Over-0.5") && !masked.includes("Over-2.5"), masked);

  const detailed = html(<CategoryPredictionsList category="VIP" rows={locked as any} view="detailed" />);
  check("locked detailed rows are still locked cards", count(detailed, "Upgrade to unlock") === 3);
}

// ===========================================================================
// 4. Ads: same positions in both views; none without the opt-in
// ===========================================================================
{
  const n = 20;
  const expected = feedAdPositions(n);
  check("fixture is long enough to carry ads", expected.length === 2, expected);
  const segments = (s: string) => s.split(ADS).map((part) => order(part).length);

  for (const view of ["detailed", "compact"] as const) {
    const withAds = html(<CategoryPredictionsList category="GENIUS" rows={rows(n) as any} withAds view={view} />);
    check(`${view}: ${expected.length} in-feed ads`, count(withAds, ADS) === expected.length, count(withAds, ADS));
    // Picks between consecutive ads: an ad after rows 6 and 12 of 20 gives 6, 6, 8
    // (each ad's own markup contains no team names, so the split is clean).
    const sizes = segments(withAds);
    const want = [...expected, n].map((p, i, a) => p - (i === 0 ? 0 : a[i - 1]));
    check(`${view}: ads sit after rows ${expected.join(", ")}`, JSON.stringify(sizes) === JSON.stringify(want), `${sizes} want ${want}`);

    // The dashboard's call: no withAds.
    const dash = html(<CategoryPredictionsList category="GENIUS" rows={rows(n) as any} view={view} />);
    check(`${view}: no ads without the opt-in (dashboard)`, count(dash, ADS) === 0);
  }
  const today = html(<CategoryPredictionsList category="TODAY" rows={rows(n) as any} withAds />);
  check("TODAY keeps its in-feed ads", count(today, ADS) === expected.length);
}

// Source-level guards the render cannot see.
{
  const root = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const dashboard = read("src/app/dashboard/page.tsx");
  check("dashboard does not pass withAds", !/\bwithAds\b/.test(dashboard));
  check("dashboard does not render the view switch", !dashboard.includes("PredictionViewSwitch"));

  const page = read("src/app/(public)/predictions/[category]/page.tsx");
  check("category page gives TODAY its own branch, without the switch",
    /cat === "TODAY" \? \(\s*<>[\s\S]*?<CategoryPredictionsList category=\{cat\} rows=\{shaped as any\} withAds \/>\s*<\/>\s*\) : \(\s*[\s\S]*?<PredictionViewSwitch/.test(page));
  check("category page renders both views with ads", count(page, 'withAds view="detailed"') === 1 && count(page, 'withAds view="compact"') === 1);
  check("category page nulls Over/Under on locked rows", /overUnder: null,\s*locked: true/.test(page));

  for (const f of [
    "src/app/(public)/predictions/team/[slug]/page.tsx",
    "src/app/(public)/predictions/league/[slug]/page.tsx",
    "src/app/(public)/predictions/cup/[slug]/page.tsx",
    "src/app/(public)/predictions/btts/page.tsx",
    "src/app/(public)/predictions/over-2-5-goals/page.tsx",
    "src/app/(public)/predictions/double-chance/page.tsx",
  ]) {
    const src = read(f);
    check(`${f.split("/").slice(-3, -1).join("/")} offers the view switch`, src.includes("<PredictionViewSwitch") && src.includes('view="compact"') && src.includes('view="detailed"'));
  }

  const sw = read("src/components/PredictionViewSwitch.tsx");
  check("the switch is a client component", sw.startsWith('"use client"'));
  check("the switch fetches nothing", !/\bfetch\(|prisma|@\/lib\/categoryPredictions/.test(sw));
  check("the switch imports no ads", !sw.includes("components/ads"));
}

// ===========================================================================
// 5. The switch and the stored preference
// ===========================================================================
{
  const out = html(
    <PredictionViewSwitch
      tabs={<nav>TABS</nav>}
      intro={<p>INTRO</p>}
      detailed={<div>DETAILED-VIEW</div>}
      compact={<div>COMPACT-VIEW</div>}
    />,
  );
  check("server render shows Detailed", out.includes("DETAILED-VIEW") && !out.includes("COMPACT-VIEW"), out);
  check("controls are a labelled group", out.includes('role="group"') && out.includes('aria-label="Prediction view"'));
  check("Detailed is pressed, Compact is not",
    /aria-pressed="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Detailed</.test(out) && /aria-pressed="false"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Compact</.test(out), out);
  check("buttons are type=button", count(out, 'type="button"') === 2);
  check("tabs, then intro, then the list",
    out.indexOf("TABS") < out.indexOf("Prediction view") && out.indexOf("Prediction view") < out.indexOf("INTRO") &&
      out.indexOf("INTRO") < out.indexOf("DETAILED-VIEW"));
}
{
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  const throwing = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceededError"); },
  };

  check("the key is the shared one", PREDICTION_VIEW_KEY === "betgenius-prediction-view");
  check("missing value falls back to detailed", readPredictionView(memory()) === "detailed");
  check("no storage falls back to detailed", readPredictionView(null) === "detailed" && readPredictionView(undefined) === "detailed");
  check("throwing storage falls back to detailed", readPredictionView(throwing) === "detailed");
  for (const bad of ["Compact", "table", "", "null", "1", " compact"]) {
    const s = memory();
    s.setItem(PREDICTION_VIEW_KEY, bad);
    check(`invalid value ${JSON.stringify(bad)} falls back to detailed`, readPredictionView(s) === "detailed");
  }
  check("parse rejects non-strings", parsePredictionView(1) === "detailed" && parsePredictionView({}) === "detailed");

  // One key for every feed: a choice made on Genius is what Banker/VIP/Goals read.
  const s = memory();
  writePredictionView(s, "compact");
  check("compact is stored under the shared key", s.m.get(PREDICTION_VIEW_KEY) === "compact");
  check("compact persists for the next feed", readPredictionView(s) === "compact");
  writePredictionView(s, "detailed");
  check("switching back persists detailed", readPredictionView(s) === "detailed");
  let threw = false;
  try { writePredictionView(throwing, "compact"); } catch { threw = true; }
  check("a failing write does not throw", !threw);
}

// ===========================================================================
// 6. Homepage category buttons
// ===========================================================================
{
  const want = [
    ["Banker Tips", "/predictions/banker"],
    ["Today's Tips", "/predictions/today"],
    ["Premium Tips", "/predictions/premium"],
    ["VIP Tips", "/predictions/vip"],
    ["Goals Tips", "/predictions/goals"],
    ["Multi Bet Tips", "/multi-bets"],
  ];
  const got = HOME_CATEGORY_LINKS.map((l) => [l.label, l.href]);
  check("homepage buttons are the explicit Tips labels, in order", JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  check("homepage includes Goals Tips", HOME_CATEGORY_LINKS.some((l) => l.label === "Goals Tips" && l.href === "/predictions/goals"));
  check("every homepage label says Tips", HOME_CATEGORY_LINKS.every((l) => /Tips$/.test(l.label)));

  const home = readFileSync(join(__dirname, "..", "src", "app", "(public)", "page.tsx"), "utf8");
  check("homepage renders HOME_CATEGORY_LINKS", home.includes("HOME_CATEGORY_LINKS.map("));
  check("See all Genius Tips is unchanged",
    home.includes('<Link href="/predictions/genius" className="btn btn-primary">See all Genius Tips</Link>'));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
