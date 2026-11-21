import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CUP_CONFIGS, cupById, cupBySlug } from "../src/lib/cupConfig";
import { TOP_CUP_IDS, MIDDLE_CUP_IDS, cupDirectoryGroups, cupDirectoryLabel, cupSearchFallback } from "../src/lib/cupSeoDirectory";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const groups = cupDirectoryGroups();
assert.deepEqual(groups.map((g) => g.key), ["top", "middle", "other"]);
const actualIds = groups.flatMap((group) => group.cups.map((cup) => cup.id));
const registryIds = CUP_CONFIGS.map((cup) => cup.id);
assert.equal(new Set(actualIds).size, CUP_CONFIGS.length, "No cup should appear in multiple tiers.");
assert.deepEqual([...actualIds].sort((a, b) => a - b), [...registryIds].sort((a, b) => a - b),
  "Every existing and future registered cup needs a directory link.");
assert.equal(groups[0].cups.length, TOP_CUP_IDS.length);
assert.equal(groups[1].cups.length, MIDDLE_CUP_IDS.length);
for (const cup of CUP_CONFIGS) {
  assert.equal(cupById(cup.id)?.slug, cup.slug);
  assert.equal(cupBySlug(cup.slug)?.id, cup.id);
  const { title, description } = cupSearchFallback(cup);
  assert.ok(title.includes("Fixtures & Results"), `${cup.slug}: distinct cup title needed`);
  assert.ok(title.length <= 47, `${cup.slug}: title exceeds the title-body budget`);
  assert.ok(description.includes(cup.name), `${cup.slug}: description needs actual competition name`);
  assert.ok(description.length <= 155, `${cup.slug}: description exceeds snippet budget`);
  assert.ok(description.includes("where published"), `${cup.slug}: no implied availability of picks`);
  assert.ok(!/top scorers|standings|guarantee/i.test(description), `${cup.slug}: do not promise unsupported data`);
  assert.ok(cupDirectoryLabel(cup).length > 10, `${cup.slug}: meaningful directory anchor`);
}
assert.equal(cupDirectoryLabel(cupById(121)!), "Danish Cup games, fixtures & results");
assert.equal(cupDirectoryLabel(cupById(81)!), "DFB Pokal fixtures & results");
const listing = read("src/components/CupDiscoveryDirectory.tsx");
assert.ok(listing.includes("/predictions/cup/"), "Directory must use canonical /cup route.");
assert.ok(listing.includes("cup.slug !== currentSlug"), "Do not link a cup to itself.");
assert.ok(listing.includes('mode = "index"') && listing.includes('"related"'), "Both main hub and cup-page navigation.");
const predIndex = read("src/app/(public)/predictions/page.tsx");
assert.ok(predIndex.includes("<CupDiscoveryDirectory />"), "Main prediction hub must include all cup tiers.");
const cupPage = read("src/app/(public)/predictions/cup/[slug]/page.tsx");
assert.ok(cupPage.includes("...cupSearchFallback(cup)"), "Unknown/mid cups receive useful shared metadata.");
assert.ok(cupPage.includes("hubContent.metadataTitle") && cupPage.includes("hubContent.metadataDescription"),
  "Do not regress pre-existing flagship competition metadata.");
assert.ok(cupPage.includes('title: "Danish Cup Games, Fixtures & Results"'),
  "Protect the already-performing Danish Cup search title.");
assert.ok(cupPage.includes("seasonRobots") && cupPage.includes('canonical: `/predictions/cup/${cup.slug}`'),
  "Preserve clean canonicals and noindex on seasonal variants.");
assert.ok(cupPage.includes('<CupDiscoveryDirectory currentSlug={data.cup.slug} mode="related" />'),
  "All cup pages need contextual cross-competition discovery.");
const sitemap = read("src/lib/sitemapEntries.ts");
assert.ok(sitemap.includes("return CUP_CONFIGS.map((cup)"), "All registered cups belong in the sitemap.");

// Each important public SEO template has a route-specific metadata export,
// not just the generic root title. A few intentionally use their layout.
// This tests CODE COVERAGE only, not live indexing or organic rankings.
const templates = [
  ["Homepage", "src/app/(public)/page.tsx", "generateMetadata"],
  ["Prediction discovery", "src/app/(public)/predictions/page.tsx", "generateMetadata"],
  ["Prediction categories", "src/app/(public)/predictions/[category]/page.tsx", "generateMetadata"],
  ["Cup pages", "src/app/(public)/predictions/cup/[slug]/page.tsx", "generateMetadata"],
  ["League pages", "src/app/(public)/predictions/league/[slug]/page.tsx", "generateMetadata"],
  ["Team pages", "src/app/(public)/predictions/team/[slug]/page.tsx", "generateMetadata"],
  ["Match pages", "src/app/(public)/predictions/match/[slug]/page.tsx", "generateMetadata"],
  ["H2H pages", "src/app/(public)/predictions/h2h/[slug]/page.tsx", "generateMetadata"],
  ["BTTS", "src/app/(public)/predictions/btts/page.tsx", "generateMetadata"],
  ["Over 2.5", "src/app/(public)/predictions/over-2-5-goals/page.tsx", "generateMetadata"],
  ["Double Chance", "src/app/(public)/predictions/double-chance/page.tsx", "generateMetadata"],
  ["Straight Wins", "src/app/(public)/predictions/straight-wins/page.tsx", "generateMetadata"],
  ["Bet of the Day", "src/app/(public)/predictions/bet-of-the-day/page.tsx", "generateMetadata"],
  ["Weekend", "src/app/(public)/predictions/weekend/page.tsx", "generateMetadata"],
  ["Midweek", "src/app/(public)/predictions/midweek/page.tsx", "generateMetadata"],
  ["Multi bets", "src/app/(public)/multi-bets/page.tsx", "export const metadata"],
  ["Guides index", "src/app/(public)/guides/page.tsx", "export const metadata"],
  ["Guide details", "src/app/(public)/guides/[slug]/page.tsx", "generateMetadata"],
  ["Track record", "src/app/(public)/track-record/page.tsx", "generateMetadata"],
  ["Methodology", "src/app/(public)/methodology/page.tsx", "trustMetadata"],
  ["Responsible gambling", "src/app/(public)/responsible-gambling/page.tsx", "trustMetadata"],
  ["Odds calculator", "src/app/(public)/odds-calculator/page.tsx", "export const metadata"],
  ["Fixtures", "src/app/(public)/fixtures/layout.tsx", "export const metadata"],
  ["Live scores", "src/app/(public)/livescores/layout.tsx", "export const metadata"],
  ["Standings", "src/app/(public)/standings/layout.tsx", "export const metadata"],
  ["StatsPad", "src/app/(public)/statspad/layout.tsx", "export const metadata"],
  ["Bet builder", "src/app/(public)/bet-builder/layout.tsx", "export const metadata"],
  ["Pricing", "src/app/(public)/pricing/layout.tsx", "export const metadata"],
] as const;
for (const [name, path, marker] of templates) {
  assert.ok(read(path).includes(marker), `${name} lacks template-specific title/description export`);
}
console.log(`Cup SEO: ${CUP_CONFIGS.length} registered cups covered across all tiers; ${templates.length} important SEO templates checked.`);
