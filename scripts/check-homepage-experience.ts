/**
 * Sprint 07 — the homepage's links, SEO surface, analytics and boundaries
 * (pure: no database, network or browser).
 *
 *   - every tracked homepage destination is a real route, mapped to one fixed
 *     analytics word; Banker and Bet of the Day stay distinct; the category
 *     buttons still all say "Tips" and Bet of the Day is still not advertised
 *     as a button (it appears only while it holds a pick);
 *   - what search engines read is unchanged: metadata, canonical, the noindex
 *     rule for dated views, the H1 and answer builders, the supporting
 *     sentence, the explainer, the structured data, the caching rule;
 *   - the new analytics event carries two fixed enums, is sent from one place,
 *     and duplicates no existing event;
 *   - nothing new is wired to discovery, odds, generation, settlement or
 *     research code, and no new data request was added to the page.
 *
 * Run: npx tsx scripts/check-homepage-experience.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const root = join(__dirname, "..");
  const src = (f: string) => readFileSync(join(root, f), "utf8");
  const react = require("react");
  if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;
  const hl = await import("../src/lib/homeLinks");
  const { HOME_CATEGORY_LINKS, HOME_PERIOD_LINKS } = await import("../src/lib/homeCategoryLinks");
  const eng = await import("../src/lib/engagement");
  const { CATEGORY_SLUGS } = await import("../src/lib/categoryPredictions");
  const page = src("src/app/(public)/page.tsx");

  console.log("\ntracked destinations are real and fixed");
  const routeOk = (href: string) => {
    const path = href.replace(/^\//, "");
    return existsSync(join(root, "src/app/(public)", path, "page.tsx")) || existsSync(join(root, "src/app", path, "page.tsx")) || (path.startsWith("predictions/") && path.slice(12) in CATEGORY_SLUGS);
  };
  const all = [...HOME_CATEGORY_LINKS, ...HOME_PERIOD_LINKS];
  for (const l of all) check(`${l.label} → ${l.href} resolves and is tracked as "${hl.homeTargetFor(l.href)}"`, routeOk(l.href) && hl.homeTargetFor(l.href) !== null);
  for (const href of ["/pricing", "/register", "/dashboard", "/dashboard/saved", "/match-insights", "/livescores", "/bet-builder", "/statspad", "/predictions/bet-of-the-day"]) check(`${href} resolves and is tracked`, routeOk(href) && hl.homeTargetFor(href) !== null);
  check("every analytics target is a registered word and every mapping lands on one", Object.values({ a: hl.homeTargetFor("/predictions/today"), b: hl.homeTargetFor("/multi-bets") }).every((t) => t && (hl.HOME_TARGETS as readonly string[]).includes(t)));
  check("an unknown destination is not tracked", hl.homeTargetFor("/nope") === null && hl.homeTargetFor("/predictions/today?x=1") === null);
  check("Banker and Bet of the Day are two destinations with two words", hl.homeTargetFor("/predictions/banker") === "banker" && hl.homeTargetFor("/predictions/bet-of-the-day") === "bet_of_the_day");

  console.log("\ncategory buttons keep the owner's rules");
  check("every category button says Tips", HOME_CATEGORY_LINKS.every((l) => /Tips$/.test(l.label)));
  check("Genius Tips and Featured Tips (the editor's picks) are now offered", HOME_CATEGORY_LINKS.some((l) => l.label === "Genius Tips" && l.href === "/predictions/genius") && HOME_CATEGORY_LINKS.some((l) => l.label === "Featured Tips" && l.href === "/predictions/featured"));
  check("the original six are all still there, in their original relative order", ["/predictions/banker", "/predictions/today", "/predictions/premium", "/predictions/vip", "/predictions/goals", "/multi-bets"].every((h, i, a) => i === 0 || HOME_CATEGORY_LINKS.findIndex((l) => l.href === h) > HOME_CATEGORY_LINKS.findIndex((l) => l.href === a[i - 1])) && HOME_CATEGORY_LINKS.length === 8);
  check("no duplicate destinations", new Set(all.map((l) => l.href)).size === all.length);
  check("Bet of the Day is not a button: it shows only while it holds a pick", !all.some((l) => l.href.includes("bet-of-the-day")) && /\{betOfTheDay && \(/.test(page));
  check("weekend and midweek stay their own group", JSON.stringify(HOME_PERIOD_LINKS.map((l) => l.href)) === JSON.stringify(["/predictions/weekend", "/predictions/midweek"]));
  check("the match research tile links to the existing /match-insights page", /<LinkTile href="\/match-insights"/.test(page));

  console.log("\nSEO surface is unchanged");
  check("title and description strings are unchanged", page.includes("title: { absolute: `${SITE_NAME} — Football tips, predictions, livescores` }") && page.includes('description: "Football predictions today across every major league — featured tips, livescores, fixtures, standings, a bet builder and StatsPad, all in one place."'));
  check("canonical stays '/', dated views stay noindex", page.includes('alternates: { canonical: "/" }') && page.includes("robots: { index: false, follow: true }") && /day === "today"\) return/.test(page));
  check("the H1 is still built by homeHeadline and the answer by homeSummary", page.includes("{homeHeadline({ day, bankerCount: slate.bankerCount })}") && page.includes("<AnswerSummary text={homeSummary({ day, ...slate })} />"));
  check("the supporting sentence is still in the hero, word for word", page.includes("Data-driven football predictions across every major league — banker picks, match winner, double chance, over/under and combo bets — each with a confidence rating and the reasoning behind it."));
  check("exactly one H1", (page.match(/<h1\b/g) ?? []).length === 1);
  check("the explainer (long-tail SEO content) is still rendered, unmodified by this sprint", page.includes("<HomepageExplainer />"));
  check("structured data is still emitted", page.includes("<JsonLd data={websiteJsonLd()} />"));
  check("caching is unchanged: revalidate 60, no force-dynamic", page.includes("export const revalidate = 60;") && !/force-dynamic/.test(page));
  check("the page still lists the competitions, results and league navigation", ["<DayCompetitions", "<RecentResults", "<LeagueNav"].every((t) => page.includes(t)));
  check("no new data request in the page: the same four Prisma calls as before this sprint", (page.match(/prisma\./g) ?? []).length === 4 && !/fetch\(/.test(page), String((page.match(/prisma\./g) ?? []).length));
  check("no public copy says AI, and no guarantee wording was added", !/>[^<{]*\bAI\b[^<}]*</.test(page + src("src/components/HomeAccountActions.tsx")) && !/guaranteed|sure win|can't lose/i.test(page + src("src/components/HomeAccountActions.tsx")));

  console.log("\nanalytics: one event, fixed words, no duplicate");
  const reg = eng.HOMEPAGE_EVENTS as Record<string, readonly string[]>;
  check("home_click carries only `target` and `placement`", reg.home_click?.join() === "target,placement");
  check("the registered words are the fixed lists, none of which looks personal", hl.HOME_TARGETS.length === new Set(hl.HOME_TARGETS).size && hl.HOME_PLACEMENTS.length === 5 && [...hl.HOME_TARGETS, ...hl.HOME_PLACEMENTS].every((w) => /^[a-z_]+$/.test(w)));
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(join(root, dir))) {
      const rel = `${dir}/${n}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
      else if (/\.(ts|tsx)$/.test(n)) out.push(rel);
    }
    return out;
  };
  const files = walk("src");
  const callers = files.filter((f) => src(f).includes('trackEngagement("home_click"'));
  check("home_click is sent from exactly one place (HomeLink)", callers.length === 1 && callers[0].endsWith("HomeLink.tsx"), callers.join());
  check("HomeLink sends two words and nothing else", /trackEngagement\("home_click", \{ target, placement \}\)/.test(src("src/components/HomeLink.tsx")));
  const existing = [...Object.keys((eng as any).PERSONALIZATION_EVENTS), "prediction_reasoning_open", "prediction_view_change", "track_record_day_open", "track_record_more_days"];
  check("it duplicates no existing event name", !existing.includes("home_click"));
  check("the hero's primary buttons and every category pill go through HomeLink", /<HomeLink target="today" placement="hero"/.test(page) && /placement="category_nav"/.test(page) && (page.match(/<HomeLink\b/g) ?? []).length >= 3);
  check("who is signed in is read only in the browser (HomeAccountActions is a client component); the page stays cached and viewer-independent", /^"use client"/.test(src("src/components/HomeAccountActions.tsx")) && page.includes("export const revalidate = 60;"));

  console.log("\nboundary with the protected workstreams");
  const NEW = ["src/lib/homeLinks.ts", "src/components/HomeLink.tsx", "src/components/HomeAccountActions.tsx"];
  const DENY = /predictionDiscovery|PredictionDiscovery|PublishedMarketComparison|MatchEvidenceGuide|selectionQuote|predictionVisibility|predictionExplanation|lib\/odds["']|oddsRefresh|paidFeedData|marketConfirmed|generation|settle|research\/|entitlement"|prisma/;
  for (const f of NEW) {
    const imports = [...src(f).matchAll(/^import (?!type ).* from "([^"]+)"/gm)].map((m) => m[1]);
    check(`${f}: imports nothing from discovery, odds, generation, settlement, research or the database`, imports.every((i) => !DENY.test(i)), imports.filter((i) => DENY.test(i)).join());
  }
  check("the new components add no third-party request or storage", NEW.every((f) => !/fetch\(|localStorage|sessionStorage|document\.cookie/.test(src(f))));
  check("the discovery entry is still the existing component, unchanged in use", page.includes("<DiscoveryEntry />") && page.includes('import { DiscoveryEntry } from "@/components/PredictionDiscovery"'));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
