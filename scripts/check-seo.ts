/**
 * Offline self-checks for the Phase 4 SEO and semantics work.
 *
 * No network, no database. What matters here is that the page makes accurate
 * claims about itself:
 *
 *   - the indexability gate scores real evidence, so a substantial page with
 *     one cold cache is still indexable and a thin one is not,
 *   - titles distinguish repeat fixtures by date,
 *   - a gated pick never reaches a meta description,
 *   - structured data asserts only what the page actually holds,
 *   - paragraph splitting doesn't shatter or merge the model's prose.
 *
 * Run: npx tsx scripts/check-seo.ts
 */
import { assessMatchEvidence, EVIDENCE_THRESHOLD, MAX_EVIDENCE_SCORE } from "../src/lib/matchEvidence";
import { SITE_URL, absoluteUrl, matchTitle, matchDescription, titleDate, fitMetadataTitleWithSuffix, fitMetaDescription, sportsEventJsonLd, sportsEventsForFixtures, organizationJsonLd, websiteJsonLd, breadcrumbJsonLd } from "../src/lib/seo";
import { toParagraphs, stripInlineMarkers } from "../src/components/Prose";
import { buildAnalysis } from "../src/lib/predictionAnalysis";
import type { TeamDigest } from "../src/lib/ai/digest";
import type { H2HMeeting } from "../src/lib/h2h";
import type { LeagueStandingRow } from "../src/lib/enrichment";
import { isSubstantiveH2H, MIN_H2H_INDEX_MEETINGS } from "../src/lib/h2hEvidence";
import { lagosDayLabel } from "../src/lib/lagosDate";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { teamSearchMetadata } from "../src/lib/teamSearchMetadata";

let passed = 0;
const failures: string[] = [];
const check = (l: string, c: boolean, got?: unknown) => {
  if (c) passed++;
  else failures.push(`${l}${got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`}`);
};

const eq = (l: string, a: unknown, b: unknown) => check(l, JSON.stringify(a) === JSON.stringify(b), a);

const teamWithFixtures = teamSearchMetadata("Arsenal", 12, 3, 10);
eq("team metadata: describes available fixtures", teamWithFixtures.title, "Arsenal Predictions & Fixtures");
check("team metadata: fixture count describes the profile inventory", teamWithFixtures.description.includes("3 upcoming fixtures"));
const teamWithoutFixtures = teamSearchMetadata("Arsenal", 12, 0, 10);
check("team metadata: does not advertise missing fixtures", !/fixtures/i.test(teamWithoutFixtures.title + teamWithoutFixtures.description));
eq("team metadata: results title needs settled rows", teamWithoutFixtures.title, "Arsenal Predictions & Results");
const pendingTeam = teamSearchMetadata("Arsenal", 1, 0, 0);
check("team metadata: no settled-result claim for pending-only inventory", !/results/i.test(pendingTeam.title + pendingTeam.description));
check("team metadata: singular pick is readable", pendingTeam.description.includes("1 published pick."));

eq("public SEO origin is the canonical domain, independent of auth configuration", SITE_URL, "https://www.betgenius.ng");
eq("child sitemap URLs use the canonical domain", absoluteUrl("/sitemaps/static.xml"), "https://www.betgenius.ng/sitemaps/static.xml");

// --- Banker hub ----------------------------------------------------------
// Static checks keep this regression gate offline: the hub must not add a
// production/database dependency merely to prove its public claims.
const repoRoot = process.cwd();
const categoryPage = readFileSync(join(repoRoot, "src/app/(public)/predictions/[category]/page.tsx"), "utf8");
const bankerGuide = readFileSync(join(repoRoot, "src/components/BankerPredictionsGuide.tsx"), "utf8");
const categoryPredictions = readFileSync(join(repoRoot, "src/lib/categoryPredictions.ts"), "utf8");
const trackRecordView = readFileSync(join(repoRoot, "src/components/TrackRecordView.tsx"), "utf8");

check("banker hub: does not claim there is only one pick", !categoryPredictions.includes("single most-confident"));
check("banker hub: accurately states the daily cap", bankerGuide.includes("Up to seven may be published"));
check("banker hub: explains that days can have no selection", bankerGuide.includes("some days will have none"));
// Banker renders through PredictionViewSwitch (Detailed / Compact), which
// places `intro` above whichever list is showing — that rendered order is
// asserted in scripts/check-prediction-view.tsx. Here: the intro is handed to
// the switch as `intro`, ahead of both lists, and both lists keep their ads.
const bankerFeed = categoryPage.slice(categoryPage.indexOf("<PredictionViewSwitch"));
check("banker hub: intro appears before the ad-enabled feed",
  categoryPage.includes("<PredictionViewSwitch") &&
    bankerFeed.includes('intro={cat === "BANKER" ? <BankerPredictionsIntro /> : null}') &&
    bankerFeed.indexOf("<BankerPredictionsIntro") < bankerFeed.indexOf("<CategoryPredictionsList"));
check("banker hub: evidence appears after the ad-enabled feed",
  categoryPage.indexOf("<BankerPredictionsEvidence") > categoryPage.lastIndexOf("<CategoryPredictionsList"));
check("banker hub: keeps the existing ad-enabled list",
  bankerFeed.includes('<CategoryPredictionsList category={cat} rows={shaped as any} withAds view="detailed" />') &&
    bankerFeed.includes('<CategoryPredictionsList category={cat} rows={shaped as any} withAds view="compact" />'));
check("banker hub: links to category-specific public evidence", bankerGuide.includes("/track-record#category-banker"));
check("banker hub: public track record exposes the Banker anchor", trackRecordView.includes('id={`category-${cat.toLowerCase().replaceAll("_", "-")}`}'));

// --- Over 2.5 Goals hub --------------------------------------------------
const over25Page = readFileSync(join(repoRoot, "src/app/(public)/predictions/over-2-5-goals/page.tsx"), "utf8");
const over25Guide = readFileSync(join(repoRoot, "src/components/Over25PredictionsGuide.tsx"), "utf8");
const marketPredictions = readFileSync(join(repoRoot, "src/lib/marketPredictions.ts"), "utf8");
const predictionsIndex = readFileSync(join(repoRoot, "src/app/(public)/predictions/page.tsx"), "utf8");
const marketHubsSrc = readFileSync(join(repoRoot, "src/lib/marketHubs.ts"), "utf8");
const sitemapEntries = readFileSync(join(repoRoot, "src/lib/sitemapEntries.ts"), "utf8");
check("over 2.5 hub: query uses structured market fields", marketPredictions.includes('marketType: "OVER_UNDER"') && marketPredictions.includes('["line"]') && marketPredictions.includes('["direction"]'));
check("over 2.5 hub: query stays bounded", marketPredictions.includes("take: 60"));
check("over 2.5 hub: explains the winning threshold", over25Guide.includes("at least three total goals"));
check("over 2.5 hub: avoids a guaranteed outcome claim", over25Guide.includes("not a guaranteed probability"));
check("over 2.5 hub: evidence renders after the ad-enabled feed", over25Page.indexOf("<Over25PredictionsEvidence") > over25Page.indexOf("<CategoryPredictionsList"));
check("over 2.5 hub: keeps the existing ad-enabled list", (over25Page.includes("<CategoryPredictionsList category=\"FEATURED\" rows={shaped as any} withAds view=\"detailed\" />") && over25Page.includes("<CategoryPredictionsList category=\"FEATURED\" rows={shaped as any} withAds view=\"compact\" />")));
check("over 2.5 hub: links to an exact public record", over25Guide.includes("/track-record#market-over-25") && trackRecordView.includes('id="market-over-25"'));
check("over 2.5 hub: receives an internal link from the predictions index", predictionsIndex.includes("MARKET_HUBS.map") && marketHubsSrc.includes('href: "/predictions/over-2-5-goals"'));
check("over 2.5 hub: sitemap inclusion uses the exact structured selection", sitemapEntries.includes("const over25Rows") && sitemapEntries.includes('direction === "OVER"'));

// --- BTTS hub ------------------------------------------------------------
const bttsPage = readFileSync(join(repoRoot, "src/app/(public)/predictions/btts/page.tsx"), "utf8");
const bttsGuide = readFileSync(join(repoRoot, "src/components/BttsPredictionsGuide.tsx"), "utf8");
check("btts hub: query uses the structured market type", marketPredictions.includes('marketType: "BTTS"'));
check("btts hub: defines both Yes and No outcomes", bttsGuide.includes('A “Yes” pick') && bttsGuide.includes('A “No” pick'));
check("btts hub: does not confuse BTTS with the match winner", bttsGuide.includes("final winner of the") && bttsGuide.includes("does not decide this market"));
check("btts hub: evidence renders after the ad-enabled feed", bttsPage.indexOf("<BttsPredictionsEvidence") > bttsPage.indexOf("<CategoryPredictionsList"));
check("btts hub: keeps the existing ad-enabled list", (bttsPage.includes("<CategoryPredictionsList category=\"FEATURED\" rows={shaped as any} withAds view=\"detailed\" />") && bttsPage.includes("<CategoryPredictionsList category=\"FEATURED\" rows={shaped as any} withAds view=\"compact\" />")));
check("btts hub: links to the exact market record", bttsGuide.includes("/track-record#market-btts") && trackRecordView.includes('id={`market-${mt.toLowerCase().replaceAll("_", "-")}`}'));
check("btts hub: receives an internal link from the predictions index", predictionsIndex.includes("MARKET_HUBS.map") && marketHubsSrc.includes('href: "/predictions/btts"'));
check("btts hub: sitemap inclusion is inventory-gated", sitemapEntries.includes("const bttsRows") && sitemapEntries.includes('r.marketType === "BTTS"'));

// --- Double Chance hub ---------------------------------------------------
const doubleChancePage = readFileSync(join(repoRoot, "src/app/(public)/predictions/double-chance/page.tsx"), "utf8");
const doubleChanceGuide = readFileSync(join(repoRoot, "src/components/DoubleChancePredictionsGuide.tsx"), "utf8");
check("double chance hub: query uses the structured market type", marketPredictions.includes('marketType: "DOUBLE_CHANCE"'));
check("double chance hub: defines all three covered pairs", doubleChanceGuide.includes("Home or Draw") && doubleChanceGuide.includes("Away or Draw") && doubleChanceGuide.includes("Home or Away"));
check("double chance hub: does not imply certainty", doubleChanceGuide.includes("does not make the pick certain"));
check("double chance hub: evidence renders after the ad-enabled feed", doubleChancePage.indexOf("<DoubleChancePredictionsEvidence") > doubleChancePage.indexOf("<CategoryPredictionsList"));
check("double chance hub: keeps the existing ad-enabled list", (doubleChancePage.includes("<CategoryPredictionsList category=\"FEATURED\" rows={shaped as any} withAds view=\"detailed\" />") && doubleChancePage.includes("<CategoryPredictionsList category=\"FEATURED\" rows={shaped as any} withAds view=\"compact\" />")));
check("double chance hub: links to the exact market record", doubleChanceGuide.includes("/track-record#market-double-chance"));
check("double chance hub: receives an internal link from the predictions index", predictionsIndex.includes("MARKET_HUBS.map") && marketHubsSrc.includes('href: "/predictions/double-chance"'));
check("double chance hub: sitemap inclusion is inventory-gated", sitemapEntries.includes("const doubleChanceRows") && sitemapEntries.includes('r.marketType === "DOUBLE_CHANCE"'));

// --- Straight Wins hub and the free-tier rule (all market hubs) ------------
const straightPage = readFileSync(join(repoRoot, "src/app/(public)/predictions/straight-wins/page.tsx"), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hubs = require("../src/lib/marketHubs") as typeof import("../src/lib/marketHubs");
check("straight wins hub: query is home or away wins only", /marketType: "MATCH_WINNER"/.test(marketPredictions) && /path: \["value"\], equals: "HOME"/.test(marketPredictions) && /path: \["value"\], equals: "AWAY"/.test(marketPredictions) && !/equals: "DRAW"/.test(marketPredictions));
check("straight wins hub: draws are not straight wins", hubs.isStraightWinSelection({ value: "HOME" }) && hubs.isStraightWinSelection({ value: "AWAY" }) && !hubs.isStraightWinSelection({ value: "DRAW" }) && !hubs.isStraightWinSelection(null));
check("straight wins hub: canonical, noindex when empty, ad-enabled list", straightPage.includes('feedDayHref("straight-wins", day)') && straightPage.includes("rows.length === 0 || day !== \"today\"") && straightPage.includes("withAds view=\"compact\""));
check("straight wins hub: sitemap inclusion is inventory-gated", sitemapEntries.includes("const straightWinRows") && sitemapEntries.includes("isStraightWinSelection(r.selection)"));
check("market hubs: every query leaves out VIP and Premium tips", (marketPredictions.match(/\.\.\.FREE_TIERS_ONLY,/g) ?? []).length === 4 && /categories: \{ none: \{ category: \{ in: \[\.\.\.MARKET_HUB_EXCLUDED_CATEGORIES\] \} \} \}/.test(marketPredictions));
check("market hubs: the sitemap counts free-tier tips only", sitemapEntries.includes("const freeRows = rows.filter(isFreeTierRow)"));
check("market hubs: VIP and Premium rows are not free-tier", !hubs.isFreeTierRow({ category: "VIP", categories: [] }) && !hubs.isFreeTierRow({ category: "FEATURED", categories: [{ category: "PREMIUM" }] }) && hubs.isFreeTierRow({ category: "GENIUS", categories: [{ category: "GENIUS" }] }));
check("market hubs: the menu, the feed chips and the homepage link to them", /MARKET_HUBS/.test(readFileSync(join(repoRoot, "src/components/Nav.tsx"), "utf8")) && /<MarketChips \/>/.test(readFileSync(join(repoRoot, "src/app/(public)/page.tsx"), "utf8")) && /<MarketChips \/>/.test(readFileSync(join(repoRoot, "src/app/(public)/predictions/[category]/page.tsx"), "utf8")));

// --- Priority competition hubs ------------------------------------------
const leaguePageSource = readFileSync(join(repoRoot, "src/app/(public)/predictions/league/[slug]/page.tsx"), "utf8");
const cupPageSource = readFileSync(join(repoRoot, "src/app/(public)/predictions/cup/[slug]/page.tsx"), "utf8");
const competitionContent = readFileSync(join(repoRoot, "src/lib/competitionHubContent.ts"), "utf8");
const competitionLinks = readFileSync(join(repoRoot, "src/components/CompetitionHubLinks.tsx"), "utf8");
const competitionIntro = readFileSync(join(repoRoot, "src/components/CompetitionHubIntro.tsx"), "utf8");
for (const [id, heading] of [
  [39, "Premier League predictions"],
  [140, "La Liga predictions"],
  [135, "Serie A predictions"],
  [78, "Bundesliga predictions"],
  [61, "Ligue 1 predictions"],
  [399, "NPFL predictions"],
  [2, "Champions League predictions"],
  [3, "Europa League predictions"],
  [848, "Conference League predictions"],
  [45, "FA Cup predictions"],
  [48, "EFL Cup predictions"],
  [143, "Copa del Rey predictions"],
  [137, "Coppa Italia predictions"],
  [81, "DFB Pokal predictions"],
  [66, "Coupe de France predictions"],
] as const) {
  check(`competition hubs: ${heading} has targeted content`, competitionContent.includes(`${id}: {`) && competitionContent.includes(`heading: "${heading}"`));
}
check("competition hubs: league route uses targeted H1 and intro", leaguePageSource.includes("hubContent?.heading") && leaguePageSource.includes("<CompetitionHubIntro"));
check("competition hubs: mobile intro is folded while desktop copy stays visible", competitionIntro.includes("<details") && competitionIntro.includes("md:hidden") && competitionIntro.includes("md:block"));
check("competition hubs: cup metadata comes from the targeted competition profile", cupPageSource.includes("hubContent.metadataTitle") && cupPageSource.includes("hubContent.metadataDescription"));
check("competition hubs: targeted cups add dynamic published picks and a settled record", cupPageSource.includes("Published ${data.cup.name} picks") && cupPageSource.includes("<RateCard stat={scoped.stat}"));
check("competition hubs: non-target cup pages retain their query profile", cupPageSource.includes("Only targeted top-tier competition hubs add prediction/proof data"));
check("competition hubs: league proof box follows the prediction feed", leaguePageSource.indexOf("<CompetitionHubLinks") > leaguePageSource.indexOf("{shaped.map"));
check("competition hubs: cup proof box follows fixtures and reference data", cupPageSource.indexOf("<CompetitionHubLinks") > cupPageSource.indexOf("<CompetitionTopPlayers"));
check("competition hubs: proof links include record, method and responsible use", competitionLinks.includes('href="/track-record"') && competitionLinks.includes('href="/methodology"') && competitionLinks.includes('href="/responsible-gambling"'));
check("competition hubs: NPFL has an explicit metadata profile", readFileSync(join(repoRoot, "src/lib/seo.tsx"), "utf8").includes('title: "NPFL Predictions — Nigeria Premier League"'));

// --- Editorial attribution ------------------------------------------------
const aboutPage = readFileSync(join(repoRoot, "src/app/(public)/about/page.tsx"), "utf8");
const matchPage = readFileSync(join(repoRoot, "src/app/(public)/predictions/match/[slug]/page.tsx"), "utf8");
const editorialTeam = readFileSync(join(repoRoot, "src/components/EditorialTeam.tsx"), "utf8");
const editorialAttribution = readFileSync(join(repoRoot, "src/components/EditorialAttribution.tsx"), "utf8");
check("editorial team: About page has a stable team section", aboutPage.includes('id: "team"') && aboutPage.includes("<EditorialTeam"));
check("editorial team: match analysis links to the team and policy", matchPage.includes("<EditorialAttribution") && editorialAttribution.includes('href="/about#team"') && editorialAttribution.includes('href="/editorial-policy"'));
check("editorial desk: does not imply multiple or independent reviewers", editorialTeam.includes("independently operated") && editorialTeam.includes("not separate people"));
check("editorial desk: uses the existing brand identity rather than a synthetic portrait", editorialTeam.includes("editorialDesk.image") && !editorialTeam.includes("AI-generated"));
check("editorial desk: is not presented as named Person schema", !editorialTeam.includes('"@type": "Person"'));

// --- Guide publishing architecture ---------------------------------------
const guidesIndex = readFileSync(join(repoRoot, "src/app/(public)/guides/page.tsx"), "utf8");
const guidePage = readFileSync(join(repoRoot, "src/app/(public)/guides/[slug]/page.tsx"), "utf8");
const guideArticle = readFileSync(join(repoRoot, "src/components/GuideArticle.tsx"), "utf8");
const guidesContent = readFileSync(join(repoRoot, "src/content/guides.tsx"), "utf8");
const sitemapEntriesSource = readFileSync(join(repoRoot, "src/lib/sitemapEntries.ts"), "utf8");
check("guides: index has unique metadata and canonical", guidesIndex.includes('title: "Football Prediction Guides"') && guidesIndex.includes('canonical: "/guides"'));
check("guides: article emits breadcrumb and Article structured data", guidePage.includes("breadcrumbJsonLd") && guidePage.includes("articleJsonLd"));
check("guides: mobile contents are folded and desktop contents remain visible", guideArticle.includes("<details") && guideArticle.includes("lg:hidden") && guideArticle.includes("hidden lg:block"));
check("guides: visible reviewed date and organization attribution", guideArticle.includes("Reviewed {formatDate") && guideArticle.includes("<EditorialAttribution"));
check("guides: first article has stable sections and related evidence links", guidesContent.includes('slug: "how-to-read-football-predictions"') && guidesContent.includes('href: "/track-record"') && guidesContent.includes('href: "/responsible-gambling"'));
check("guides: index and published guides are sitemap entries", sitemapEntriesSource.includes('{ path: "/guides"') && sitemapEntriesSource.includes("GUIDES.map"));

// SEO-302: the first eight evergreen guides. The content is JSX compiled
// with the classic runtime here, so React must be in scope before loading it.
(globalThis as { React?: unknown }).React = require("react");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GUIDES } = require("../src/content/guides") as typeof import("../src/content/guides");
check("guides: nine published", GUIDES.length === 9, String(GUIDES.length));
check("guides: unique slugs", new Set(GUIDES.map((g) => g.slug)).size === GUIDES.length);
check("guides: unique section ids within each guide", GUIDES.every((g) => new Set(g.sections.map((x) => x.id)).size === g.sections.length));
check("guides: every guide has a description, summary and at least three related links", GUIDES.every((g) => g.description.length > 60 && g.summary.length > 40 && g.related.length >= 3));
// Every related link resolves to a route that exists, or to another guide.
const routeExists = (href: string) => {
  const path = href.split("#")[0];
  if (path.startsWith("/guides/")) return GUIDES.some((g) => `/guides/${g.slug}` === path);
  const appDir = join(repoRoot, "src/app/(public)");
  if (existsSync(join(appDir, path, "page.tsx"))) return true;
  // /predictions/<category> feeds are one dynamic route.
  const feed = path.match(/^\/predictions\/([a-z0-9-]+)$/);
  return !!feed && ["banker", "goals", "vip", "premium", "today", "featured", "genius"].includes(feed[1]);
};
const brokenLinks = GUIDES.flatMap((g) => g.related.filter((r) => !routeExists(r.href)).map((r) => `${g.slug} -> ${r.href}`));
check("guides: every related link resolves to a real page", brokenLinks.length === 0, brokenLinks.join(", "));
check("guides: each guide leads into the product, not only to other guides", GUIDES.every((g) => g.related.some((r) => !r.href.startsWith("/guides/"))));
// The worked arithmetic quoted in the copy, recomputed.
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;
check("guides: 2.50 implies 40%", near(100 / 2.5, 40));
check("guides: margin example 2.10/3.40/3.60 totals 104.8%, home fair ~45.4%", near((1 / 2.1 + 1 / 3.4 + 1 / 3.6) * 100, 104.8) && near((100 / 2.1) / (1 / 2.1 + 1 / 3.4 + 1 / 3.6), 45.4));
check("guides: 1X from 2.10 and 3.40 sits near 1.30 (77%)", near(1 / (1 / 2.1 + 1 / 3.4), 1.3, 0.01) && near((1 / 2.1 + 1 / 3.4) * 100, 77, 0.1));
check("guides: 1.50 x 1.60 x 1.80 = 4.32", near(1.5 * 1.6 * 1.8, 4.32, 0.001));
check("guides: four 70% legs land about 24% of the time", near(0.7 ** 4 * 100, 24, 0.1));
check("guides: five straight losses at 60% wins is about 1%", near(0.4 ** 5 * 100, 1, 0.05));
check("guides: 1.30 implies about 77%", near(100 / 1.3, 77, 0.1));
const guideCopy = guidesContent.toLowerCase();
// SEO-403: the odds-to-probability calculator.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const calc = require("../src/lib/oddsCalculator") as typeof import("../src/lib/oddsCalculator");
check("calculator: decimal, fractional and American odds all read as 2.50", [calc.parseOdds("2.5"), calc.parseOdds("6/4"), calc.parseOdds("+150")].every((d) => d != null && near(d, 2.5, 1e-9)));
check("calculator: -200 reads as 1.50", near(calc.parseOdds("-200") ?? 0, 1.5, 1e-9));
check("calculator: non-prices are refused", ["", "1", "1.00", "0.5", "abc", "6/0", "+50", "2.5.1"].every((x) => calc.parseOdds(x) === null));
check("calculator: 2.50 implies 40%", near(calc.impliedProbability(2.5), 0.4, 1e-9));
check("calculator: ₦1,000 at 2.50 returns ₦2,500, ₦1,500 profit", JSON.stringify(calc.returnOn(1000, 2.5)) === JSON.stringify({ total: 2500, profit: 1500 }));
const mv = calc.marketView([2.1, 3.4, 3.6]);
check("calculator: 2.10/3.40/3.60 carries a 4.8% margin", !!mv && near(mv.margin * 100, 4.8, 0.05));
check("calculator: fair chances sum to 100%", !!mv && near(mv.fair.reduce((a, b) => a + b, 0), 1, 1e-9));
check("calculator: an incomplete market is refused", calc.marketView([2.1]) === null && calc.marketView([2.1, 1]) === null);
const calcPage = readFileSync(join(repoRoot, "src/app/(public)/odds-calculator/page.tsx"), "utf8");
check("calculator: canonical, breadcrumb and responsible-betting disclaimer", calcPage.includes('canonical: "/odds-calculator"') && calcPage.includes("breadcrumbJsonLd") && calcPage.includes("/responsible-gambling") && calcPage.includes("18 or over"));
check("calculator: in the sitemap and the footer", sitemapEntriesSource.includes('{ path: "/odds-calculator"') && readFileSync(join(repoRoot, "src/components/SiteFooter.tsx"), "utf8").includes('"/odds-calculator"'));
// SEO-503: contextual internal links.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const links = require("../src/lib/contextualLinks") as typeof import("../src/lib/contextualLinks");
const pk = (marketType: string, selection: unknown = null, cats: string[] = []) => links.pathwayKey({ marketType, selection, categories: cats.map((category) => ({ category })) });
check("links: over 2.5 maps to the Over 2.5 pathway", pk("OVER_UNDER", { line: 2.5, direction: "OVER" }) === "OVER_2_5");
check("links: other goal lines map to the goals pathway", pk("OVER_UNDER", { line: 1.5, direction: "OVER" }) === "GOALS" && pk("OVER_UNDER", { line: 2.5, direction: "UNDER" }) === "GOALS");
check("links: BTTS, double chance and straight wins map to their own", pk("BTTS") === "BTTS" && pk("DOUBLE_CHANCE") === "DOUBLE_CHANCE" && pk("MATCH_WINNER", { value: "HOME" }) === "MATCH_WINNER" && pk("MATCH_WINNER", { value: "AWAY" }) === "MATCH_WINNER");
check("links: a draw pick gets no straight-win pathway", pk("MATCH_WINNER", { value: "DRAW" }) === null);
check("links: a Banker-tagged pick leads to the Banker pathway, whatever its market", pk("MATCH_WINNER", null, ["BANKER"]) === "BANKER");
check("links: a combo leads to multi bets", pk("SAME_GAME_DOUBLE") === "COMBO");
check("links: markets with no explainer get none", pk("CORRECT_SCORE") === null && pk("OTHER") === null);
const many = [{ marketType: "BTTS" }, { marketType: "BTTS" }, { marketType: "DOUBLE_CHANCE" }, { marketType: "MATCH_WINNER", selection: { value: "AWAY" } }, { marketType: "SAME_GAME_DOUBLE" }];
check("links: one pathway per market, in page order, at most three", JSON.stringify(links.marketPathways(many).map((p) => p.key)) === JSON.stringify(["BTTS", "DOUBLE_CHANCE", "MATCH_WINNER"]));
const brokenTargets = links.ALL_PATHWAY_TARGETS.filter((t) => !routeExists(t.href)).map((t) => t.href);
check("links: every hub, guide and record target resolves to a real page", brokenTargets.length === 0, brokenTargets.join(", "));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MARKET_TYPES } = require("../src/lib/markets") as typeof import("../src/lib/markets");
const anchors = new Set([
  "market-over-25", "category-banker",
  ...MARKET_TYPES.filter((m) => m !== "OTHER").map((m) => `market-${m.toLowerCase().replaceAll("_", "-")}`),
]);
const badAnchors = links.ALL_PATHWAY_TARGETS.filter((t) => t.href.includes("#") && !anchors.has(t.href.split("#")[1])).map((t) => t.href);
check("links: every track-record anchor exists on the page", badAnchors.length === 0, badAnchors.join(", "));
const matchPageForLinks = readFileSync(join(repoRoot, "src/app/(public)/predictions/match/[slug]/page.tsx"), "utf8");
check("links: match pages build pathways from publicly visible picks only", matchPageForLinks.includes("pathways={marketPathways(rows.filter((r) => canViewCategory(presentedCategory(r.category, r.categories), undefined, undefined, undefined)))}"));
check("links: the match footer renders them", readFileSync(join(repoRoot, "src/components/MatchPageFooterLinks.tsx"), "utf8").includes("Understand these picks"));
const hubGuide: Array<[string, string]> = [
  ["src/components/BttsPredictionsGuide.tsx", "/guides/both-teams-to-score-explained"],
  ["src/components/Over25PredictionsGuide.tsx", "/guides/over-under-goals-explained"],
  ["src/components/DoubleChancePredictionsGuide.tsx", "/guides/double-chance-explained"],
  ["src/components/BankerPredictionsGuide.tsx", "/guides/what-is-a-banker-bet"],
  ["src/components/TodayPredictionsGuide.tsx", "/guides"],
  ["src/components/CompetitionHubLinks.tsx", "/guides/how-to-read-football-predictions"],
];
const missingHubGuides = hubGuide.filter(([f, href]) => !readFileSync(join(repoRoot, f), "utf8").includes(`href="${href}"`)).map(([f]) => f);
check("links: each market hub links to the guide for its market", missingHubGuides.length === 0, missingHubGuides.join(", "));
// Phrases inside &quot;...&quot; are quoted, not promised: the scam guide names
// them as warning signs. Everything outside quotation marks must still be clean.
const unquotedGuideCopy = guideCopy.replace(/&quot;[^&]*?&quot;/g, "");
check("guides: no certainty promises in the copy", !/\b(guaranteed (win|profit)|sure win|100% sure|risk-free|can't lose|cannot lose)\b/.test(unquotedGuideCopy));
check("guides: the quoted-phrase exemption still sees unquoted text", /\bsure win\b/.test("a sure win here &quot;quoted&quot;".replace(/&quot;[^&]*?&quot;/g, "")));

// --- Lagos date labels ----------------------------------------------------
// Server locale must not move or rename the date shown on the daily hub.
const lateUtc = new Date("2026-09-10T23:30:00Z");
eq("Lagos date label: today crosses the UTC boundary correctly", lagosDayLabel(0, lateUtc), "Friday, 11 September 2026");
eq("Lagos date label: yesterday stays relative to the Lagos day", lagosDayLabel(-1, lateUtc), "Thursday, 10 September 2026");

// --- Daily-guide placement ------------------------------------------------
const todayGuideSource = readFileSync(join(process.cwd(), "src/components/TodayPredictionsGuide.tsx"), "utf8");
const categoryPageSource = readFileSync(join(process.cwd(), "src/app/(public)/predictions/[category]/page.tsx"), "utf8");
check("today guide uses a native disclosure", todayGuideSource.includes("<details") && todayGuideSource.includes("<summary"));
check("today evidence remains a distinct linked section", todayGuideSource.includes("export function TodayPredictionsEvidence"));
check(
  "today evidence renders after the prediction feed",
  categoryPageSource.indexOf("<TodayPredictionsEvidence") > categoryPageSource.indexOf("<CategoryPredictionsList"),
);

function digest(over: Partial<TeamDigest> = {}): TeamDigest {
  return {
    name: "T", apiId: 1, rank: null, points: null,
    overall: null, home: null, away: null,
    goalsForAvg: null, goalsAgainstAvg: null, cleanSheets: null, failedToScore: null,
    form: null, streak: null, biggest: null, formations: [], cards: null, penalties: null,
    last5: [], availability: [], availabilityAsOf: null, keyPlayers: [],
    ...over,
  };
}

const warmDigest = digest({
  overall: { played: 17, win: 13, draw: 3, loss: 1, goalsFor: 47, goalsAgainst: 23 },
  home: { played: 8, win: 6, draw: 2, loss: 0, goalsFor: 23, goalsAgainst: 11 },
  goalsForAvg: { total: 2.8, home: 2.9, away: 2.7 },
  last5: [1, 2, 3, 4, 5].map((i) => ({ opponent: `O${i}`, venue: "home" as const, result: "W", goalsFor: 2, goalsAgainst: 0, date: `2026-08-0${i}` })),
});

const meetings = (n: number): H2HMeeting[] =>
  Array.from({ length: n }, (_, i) => ({
    fixtureApiId: i, date: `2026-0${i + 1}-01T00:00:00Z`, leagueName: "L", leagueApiId: 1,
    homeTeamApiId: 1, homeTeam: "A", awayTeamApiId: 2, awayTeam: "B", homeGoals: 1, awayGoals: 0,
  }));

const table: LeagueStandingRow[] = [
  { rank: 1, teamId: 1, teamName: "A", teamLogo: null, points: 40, played: 20, win: 12, draw: 4, loss: 4, goalsFor: 30, goalsAgainst: 20, form: null, zone: null },
  { rank: 2, teamId: 2, teamName: "B", teamLogo: null, points: 38, played: 20, win: 11, draw: 5, loss: 4, goalsFor: 28, goalsAgainst: 21, form: null, zone: null },
];

const base = {
  homeDigest: null, awayDigest: null, standings: null,
  homeTeamApiId: 1, awayTeamApiId: 2, h2hMeetings: [] as H2HMeeting[],
  matchPreview: null, analysisJson: null,
};

// --- Evidence model -------------------------------------------------------
const empty = assessMatchEvidence(base);
eq("evidence: an empty page scores zero", empty.score, 0);
check("evidence: an empty page is not substantive", !empty.substantive);
eq("evidence: threshold is exposed for the caller", empty.threshold, EVIDENCE_THRESHOLD);
check("evidence: max score is derived from the weights", MAX_EVIDENCE_SCORE > EVIDENCE_THRESHOLD);

// A warm team cache alone should clear the bar — form, record and venue splits
// IS a substantial page.
const warmOnly = assessMatchEvidence({ ...base, homeDigest: warmDigest });
check("evidence: warm team cache alone is substantive", warmOnly.substantive, warmOnly);
eq("evidence: warm cache lights teamData/recentForm/statistics",
  warmOnly.present.sort(), ["recentForm", "statistics", "teamData"]);

// The path that matters: no digest at all, but real h2h + analysis + table.
const noDigest = assessMatchEvidence({
  ...base,
  h2hMeetings: meetings(6),
  standings: table,
  matchPreview: "x".repeat(400),
});
check("evidence: h2h + analysis + standings is substantive without any digest", noDigest.substantive, noDigest);

// Genuinely thin: a pick, a table row, and "nobody is out".
const thin = assessMatchEvidence({
  ...base,
  standings: table,
  homeDigest: digest({ availabilityAsOf: "2026-08-17", availability: [] }),
  matchPreview: "x".repeat(400),
});
check("evidence: analysis + standings + team news alone is NOT substantive", !thin.substantive, thin);

// One cold cache must not sink a page that has everything else.
const oneCold = assessMatchEvidence({
  ...base, homeDigest: warmDigest, awayDigest: null, standings: table, h2hMeetings: meetings(5), matchPreview: "x".repeat(400),
});
check("evidence: one cold side does not suppress an otherwise full page", oneCold.substantive, oneCold);

// Signal-level correctness.
eq("evidence: 2 meetings is too few for h2h", assessMatchEvidence({ ...base, h2hMeetings: meetings(2) }).signals.headToHead, false);
eq("evidence: 3 meetings counts", assessMatchEvidence({ ...base, h2hMeetings: meetings(3) }).signals.headToHead, true);
eq("h2h index: threshold stays aligned with match evidence", MIN_H2H_INDEX_MEETINGS, 3);
check("h2h index: two meetings remain a thin sample", !isSubstantiveH2H(meetings(2)));
check("h2h index: three meetings clear the index bar", isSubstantiveH2H(meetings(3)));
eq("evidence: h2h needs both team ids",
  assessMatchEvidence({ ...base, h2hMeetings: meetings(6), homeTeamApiId: null }).signals.headToHead, false);
eq("evidence: an unplayed table row is not standings evidence",
  assessMatchEvidence({ ...base, standings: table.map((r) => ({ ...r, played: 0 })) }).signals.standings, false);
eq("evidence: a stub preview is not analysis", assessMatchEvidence({ ...base, matchPreview: "Too short." }).signals.analysis, false);
eq("evidence: key factors alone count as analysis",
  assessMatchEvidence({ ...base, analysisJson: buildAnalysis({ keyFactors: ["a", "b"] }) }).signals.analysis, true);
eq("evidence: a resolved-but-empty team news feed still counts",
  assessMatchEvidence({ ...base, homeDigest: digest({ availabilityAsOf: "2026-08-17", availability: [] }) }).signals.teamNews, true);
eq("evidence: an unresolved feed does not count",
  assessMatchEvidence({ ...base, homeDigest: digest() }).signals.teamNews, false);

// --- Titles ---------------------------------------------------------------
const t = matchTitle({ homeTeam: "Casa Pia", awayTeam: "Benfica", kickoff: "2026-08-17T16:15:00Z" });
eq("title: reads as one natural phrase", t, "Casa Pia vs Benfica prediction, 17 Aug 2026");
check("title: not keyword-stuffed", !/tips|odds|betting|h2h|preview/i.test(t), t);
eq("title: survives a missing kickoff",
  matchTitle({ homeTeam: "A", awayTeam: "B", kickoff: null }), "A vs B prediction");

// The whole reason the date is there: repeat fixtures must not share a title.
const s1 = matchTitle({ homeTeam: "A", awayTeam: "B", kickoff: "2025-08-17T00:00:00Z" });
const s2 = matchTitle({ homeTeam: "A", awayTeam: "B", kickoff: "2026-08-17T00:00:00Z" });
check("title: repeat fixtures get distinct titles", s1 !== s2, [s1, s2]);
const longTitle = matchTitle({
  homeTeam: "Podhale Nowy Targ Football Club",
  awayTeam: "Pogon Grodzisk Mazowiecki United",
  kickoff: "2026-08-17T00:00:00Z",
});
check("title: generated title leaves room for the brand suffix", longTitle.length <= 47, longTitle);
check("title: shortening retains prediction intent and date", longTitle.includes("prediction") && longTitle.includes("2026"), longTitle);
const longH2hTitle = fitMetadataTitleWithSuffix("A Very Long Football Club Name vs Another Extremely Long Football Club Name", "head-to-head");
check("title: suffix-aware shortening retains H2H intent", longH2hTitle.length <= 47 && longH2hTitle.endsWith("head-to-head"), longH2hTitle);

// Day derivation must be UTC, matching the slug's own day.
eq("titleDate: uses UTC, not local time", titleDate("2026-08-17T23:30:00Z"), "17 Aug 2026");
eq("titleDate: rejects a bad date", titleDate("nonsense"), null);

// --- Descriptions ---------------------------------------------------------
const d = matchDescription({
  homeTeam: "Casa Pia", awayTeam: "Benfica", leagueName: "Primeira Liga", kickoff: "2026-08-17T16:15:00Z",
  topPick: { market: "Match Winner", pick: "Benfica to win", confidence: 72 }, marketCount: 3,
});
check("description: leads with the actual call", d.includes("Benfica to win"), d);
check("description: states confidence", d.includes("72%"), d);
check("description: mentions the remaining markets", d.includes("2 more markets"), d);
check("description: includes league and date", d.includes("Primeira Liga") && d.includes("17 Aug 2026"), d);
check("description: generated match snippets stay within budget", d.length <= 155, d);
const longDescription = fitMetaDescription("A deliberately long generated description ".repeat(10));
check("description: shared limiter stays within budget", longDescription.length <= 155, longDescription.length);

// The gating case: no publicly visible pick must never leak one.
const gated = matchDescription({
  homeTeam: "A", awayTeam: "B", leagueName: "L", kickoff: "2026-08-17T00:00:00Z", topPick: null, marketCount: 2,
});
check("description: no pick when every row is gated", !/we back/i.test(gated), gated);
check("description: still describes the page usefully", gated.includes("head-to-head"), gated);
check("description: single market does not say 'more markets'",
  !matchDescription({ homeTeam: "A", awayTeam: "B", kickoff: null, topPick: { market: "M", pick: "P", confidence: 50 }, marketCount: 1 }).includes("more market"));

// --- Structured data ------------------------------------------------------
const ld: any = sportsEventJsonLd({
  homeTeam: "Casa Pia", awayTeam: "Benfica", kickoff: "2026-08-17T16:15:00Z", league: "Primeira Liga",
  url: "/predictions/match/x", venue: "Estadio Pina Manique", city: "Lisboa",
  datePublished: "2026-08-16T10:00:00Z", dateModified: "2026-08-17T09:00:00Z",
});
eq("jsonld: is a SportsEvent", ld["@type"], "SportsEvent");
eq("jsonld: carries the venue as a Place", ld.location?.name, "Estadio Pina Manique");
eq("jsonld: carries the city", ld.location?.address?.addressLocality, "Lisboa");
eq("jsonld: carries datePublished", ld.datePublished, "2026-08-16T10:00:00.000Z");
eq("jsonld: carries dateModified", ld.dateModified, "2026-08-17T09:00:00.000Z");
eq("jsonld: absolute url", typeof ld.url === "string" && ld.url.startsWith("http"), true);

// Venue must be omitted, not faked, when the cache has none.
const noVenue: any = sportsEventJsonLd({ homeTeam: "A", awayTeam: "B", kickoff: null, url: "/x" });
check("jsonld: omits location when no venue is cached", !("location" in noVenue), noVenue);
check("jsonld: omits startDate when no kickoff", !("startDate" in noVenue), noVenue);
check("jsonld: omits dates when unknown", !("datePublished" in noVenue) && !("dateModified" in noVenue), noVenue);

// The deliberate absences.
const asString = JSON.stringify([ld, organizationJsonLd(), breadcrumbJsonLd([{ name: "H", path: "/" }])]);
check("jsonld: no FAQPage anywhere", !asString.includes("FAQPage"), asString.slice(0, 120));
check("jsonld: no Article markup anywhere", !/"@type":"(News)?Article"/.test(asString));
eq("jsonld: organization is an Organization", (organizationJsonLd() as any)["@type"], "Organization");
const org: any = organizationJsonLd();
const website: any = websiteJsonLd();
eq("jsonld homepage: WebSite uses the brand name", website.name, "BetGenius");
eq("jsonld homepage: WebSite publisher resolves to Organization", website.publisher?.["@id"], org["@id"]);
check("jsonld homepage: omits false crawlable search action", !("potentialAction" in website), website);
check("jsonld match: competition is not mislabelled as organizer", !("organizer" in ld), ld.organizer);

const feedEvents: any[] = sportsEventsForFixtures([
  { homeTeam: "A", awayTeam: "B", kickoff: "2026-08-17T12:00:00Z", league: "League", publicPick: null },
  { homeTeam: "A", awayTeam: "B", kickoff: "2026-08-17T12:00:00Z", league: "League", publicPick: { market: "Winner", pick: "A", confidence: 70 } },
]);
eq("jsonld league/team: duplicate market rows produce one event", feedEvents.length, 1);
check("jsonld league/team: feed event describes the public pick", feedEvents[0].description.includes("we back A"), feedEvents[0]);

for (const [template, path] of [
  ["match", "/predictions/match/a-vs-b-2026-08-17"],
  ["league", "/predictions/league/premier-league"],
  ["team", "/predictions/team/arsenal"],
  ["h2h", "/predictions/h2h/arsenal-vs-chelsea"],
] as const) {
  const crumb: any = breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: template, path }]);
  eq(`jsonld ${template}: breadcrumb identifies canonical page`, crumb.itemListElement[1].item, `https://www.betgenius.ng${path}`);
}

// --- Prose ----------------------------------------------------------------
const twoParas = "Casa Pia host Benfica in the second round.\n\nBenfica were held to a 2-2 draw.";
eq("prose: splits on blank lines", toParagraphs(twoParas).length, 2);
eq("prose: does not split on a single newline", toParagraphs("one\ntwo").length, 1);
eq("prose: joins soft-wrapped lines into one paragraph", toParagraphs("one\ntwo")[0], "one two");
eq("prose: empty input yields nothing", toParagraphs(null), []);

// The Groq fallback emits markdown that the Gemini primary does not, so these
// are live cases now rather than defensive hypotheticals.
const groqStyle = ["**Sirius** are leaders.", "", "## Outlook", "Hacken sit *third*."].join("\n");
eq("prose: a heading after a blank line does not merge two paragraphs", toParagraphs(groqStyle).length, 2);
eq("prose: heading hashes are stripped but their text is kept",
  toParagraphs(groqStyle)[1], "Outlook Hacken sit third.");
check("prose: no raw bold markers survive", !toParagraphs(groqStyle).join(" ").includes("**"));
check("prose: no raw heading markers survive", !toParagraphs(groqStyle).join(" ").includes("#"));
eq("prose: an indented heading is still stripped", stripInlineMarkers("   ### Title"), "Title");
// The bug this guards: \s in the indent class swallowed the preceding newline.
check("prose: stripping a heading preserves the blank line before it",
  stripInlineMarkers(["a.", "", "## B"].join("\n")).includes("\n\n"));
eq("prose: whitespace-only input yields nothing", toParagraphs("   \n\n   "), []);
eq("prose: collapses runs of blank lines", toParagraphs("a\n\n\n\nb").length, 2);

// Markers don't occur in today's output, but must degrade cleanly if they start.
eq("prose: strips bold markers", stripInlineMarkers("**Benfica** are strong"), "Benfica are strong");
eq("prose: strips heading hashes", stripInlineMarkers("## Preview"), "Preview");
eq("prose: strips code ticks", stripInlineMarkers("the `xG` figure"), "the xG figure");
check("prose: leaves ordinary text untouched", stripInlineMarkers("Casa Pia 1-0 Benfica") === "Casa Pia 1-0 Benfica");

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("All SEO and semantics checks passed.");
