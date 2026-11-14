/**
 * Sprint 04 — the Tips menu taxonomy and current-page logic (pure, no DB).
 *
 * Proves, from the one list the desktop menu and the phone drawer both read
 * (src/lib/predictionNav.ts):
 *   - every link a reader had before Sprint 04 is still there, same label,
 *     same URL (no route or product name moved);
 *   - each link sits under the right kind of heading, and the three kinds do
 *     not overlap: days, curated products, markets;
 *   - every destination is a real route (a page file or a category slug), and
 *     nothing is advertised that does not resolve;
 *   - Banker and Bet of the Day stay two products; markets keep the hub labels;
 *     VIP and Premium keep their markers;
 *   - isCurrentPath / onTipsPage are segment-aware;
 *   - the navigation files import nothing from the discovery or reliability
 *     workstreams, so they cannot interfere with PR #184.
 *
 * Run: npx tsx scripts/check-category-navigation.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const nav = await import("../src/lib/predictionNav");
  const { MARKET_HUBS } = await import("../src/lib/marketHubs");
  const root = join(__dirname, "..");
  // categoryPredictions imports React cache() and the database client.
  const react = require("react");
  if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;
  const { CATEGORY_SLUGS, CATEGORY_CHIP_LABELS } = await import("../src/lib/categoryPredictions");

  const all = nav.TIP_GROUPS.flatMap((g) => g.items);
  const byHref = new Map(all.map((l) => [l.href, l]));

  console.log("\nnothing a reader had before has moved");
  const BEFORE: [string, string][] = [
    ["Today", "/predictions/today"], ["Genius", "/predictions/genius"], ["Featured", "/predictions/featured"], ["Banker", "/predictions/banker"],
    ["Combo Bets", "/predictions/combo-bets"], ["Goals", "/predictions/goals"], ["VIP", "/predictions/vip"], ["Premium", "/predictions/premium"],
    ["Straight Wins", "/predictions/straight-wins"], ["Double Chance", "/predictions/double-chance"], ["BTTS", "/predictions/btts"], ["Over 2.5", "/predictions/over-2-5-goals"],
  ];
  for (const [label, href] of BEFORE) check(`${label} → ${href}`, byHref.get(href)?.label === label, String(byHref.get(href)?.label));

  console.log("\ngrouping: days, curated products, markets");
  const ids = nav.TIP_GROUPS.map((g) => g.id).join(",");
  check("three groups in order: day, curated, market", ids === "day,curated,market", ids);
  check("every link is in exactly one group", all.length === byHref.size && all.length === 3 + 8 + 4, `${all.length} links, ${byHref.size} unique`);
  check("days are Today, Weekend, Midweek", nav.DAY_LINKS.map((l) => l.label).join() === "Today,Weekend,Midweek");
  check("markets are exactly the market hubs, same order, same labels", nav.MARKET_LINKS.map((l) => `${l.label}|${l.href}`).join() === MARKET_HUBS.map((m) => `${m.label}|${m.href}`).join());
  check("Weekend and Midweek are now reachable from the menu", byHref.has("/predictions/weekend") && byHref.has("/predictions/midweek"));
  check("no market appears among the curated products", nav.CURATED_LINKS.every((l) => !MARKET_HUBS.some((m) => m.href === l.href)));
  check("no curated product appears among the days", nav.DAY_LINKS.every((l) => !nav.CURATED_LINKS.some((c) => c.href === l.href)));

  console.log("\nproduct names and distinctions");
  const banker = byHref.get("/predictions/banker");
  const botd = byHref.get("/predictions/bet-of-the-day");
  check("Banker and Bet of the Day are two links with two routes and two names", !!banker && !!botd && banker.label !== botd.label && banker.href !== botd.href);
  check("Bet of the Day carries its own name, not Banker's", botd?.label === "Bet of the Day");
  check("curated labels match the card chip labels", [
    ["/predictions/genius", "GENIUS"], ["/predictions/featured", "FEATURED"], ["/predictions/banker", "BANKER"], ["/predictions/bet-of-the-day", "BET_OF_THE_DAY"],
    ["/predictions/goals", "GOALS"], ["/predictions/vip", "VIP"], ["/predictions/premium", "PREMIUM"],
  ].every(([href, cat]) => byHref.get(href)?.label === (CATEGORY_CHIP_LABELS as Record<string, string>)[cat]));
  check("Combo Bets keeps the display-layer name", byHref.get("/predictions/combo-bets")?.label === "Combo Bets");
  check("VIP and Premium keep their markers, nothing else has one", all.filter((l) => l.pill).map((l) => `${l.label}:${l.pill}`).join() === "VIP:vip,Premium:premium");
  check("no menu label says AI", all.every((l) => !/\bAI\b/i.test(l.label)));

  console.log("\nevery destination is real");
  const page = (p: string) => existsSync(join(root, "src/app/(public)", p, "page.tsx"));
  for (const l of all) {
    const slug = l.href.replace(/^\/predictions\//, "");
    const ok = page(l.href.slice(1)) || slug in CATEGORY_SLUGS;
    check(`${l.href} resolves`, ok);
  }
  check("the empty /combos page is not advertised", !byHref.has("/combos") && !all.some((l) => l.href.includes("combos") && !l.href.includes("combo-bets")));

  console.log("\ncurrent page");
  const cur = nav.isCurrentPath;
  check("exact match", cur("/predictions/btts", "/predictions/btts"));
  check("trailing slash tolerated", cur("/predictions/btts", "/predictions/btts/"));
  check("a page under the link counts", cur("/predictions/genius", "/predictions/genius/anything"));
  check("a longer sibling does not", !cur("/predictions/goals", "/predictions/goals-extra"));
  check("the other market does not", !cur("/predictions/btts", "/predictions/over-2-5-goals"));
  check("Banker is not current on Bet of the Day", !cur("/predictions/banker", "/predictions/bet-of-the-day") && cur("/predictions/bet-of-the-day", "/predictions/bet-of-the-day"));
  check("null and empty pathnames are never current", !cur("/predictions/today", null) && !cur("/predictions/today", undefined) && !cur("/predictions/today", ""));
  check("the homepage is not inside any menu link", !cur("/predictions/today", "/"));
  check("onTipsPage: true on a tips page, false elsewhere", nav.onTipsPage("/predictions/weekend") && nav.onTipsPage("/predictions/over-2-5-goals") && !nav.onTipsPage("/multi-bets") && !nav.onTipsPage("/") && !nav.onTipsPage(null));
  check("onTipsPage: false on the /predictions index and on a match page (not a menu entry)", !nav.onTipsPage("/predictions") && !nav.onTipsPage("/predictions/match/a-vs-b-2026-01-01"));

  console.log("\nboundary with the discovery and reliability workstreams");
  const src = (f: string) => readFileSync(join(root, f), "utf8");
  const FILES = ["src/lib/predictionNav.ts", "src/components/Nav.tsx"];
  const DENY = /predictionDiscovery|PredictionDiscovery|PublishedMarketComparison|MatchEvidenceGuide|predictionExplanation|predictionVisibility|selectionQuote|FeedDayTabs|odds|evidence|settle|generation|entitlement/i;
  for (const f of FILES) {
    const imports = [...src(f).matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]);
    check(`${f} imports nothing owned by another workstream`, imports.every((i) => !DENY.test(i)), imports.filter((i) => DENY.test(i)).join());
  }
  check("predictionNav is client-safe: no database or server imports", !/prisma|next\/headers|server-only/.test(src("src/lib/predictionNav.ts")));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
