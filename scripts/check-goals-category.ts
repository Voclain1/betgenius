/**
 * Asserts the Goals category (src/lib/goalsCategory.ts).
 *
 * GOALS holds Over 1.5 and Over 2.5 total goals and nothing else, and is
 * derived from the structured market on every category write rather than
 * chosen by anyone. The failures this guards against:
 *
 *   - classifying by text, which would take a TEAM_TOTAL "Over 1.5", a combo
 *     whose label mentions Over 2.5, or any row's secondary ouLine side info;
 *   - a market edit or rewrite that leaves a stale GOALS tag behind, or never
 *     adds it;
 *   - same-game-double source legs leaking into a public feed through it;
 *   - the admin editor sending GOALS back to a schema that rejects it, which
 *     would make every Goals row unsaveable;
 *   - disturbing anything that already exists: other feeds, entitlement,
 *     settlement, or the homepage Genius rule that keeps O/U 2.5 out.
 *
 * Pure: no database, no network. Run: npx tsx scripts/check-goals-category.ts
 */
export {};
import { readFileSync } from "node:fs";

const react = require("react");
react.cache = (fn: any) => fn;

import { GOALS, GOALS_LINES, isGoalsPrediction, withGoalsCategory, goalsFeedRows } from "../src/lib/goalsCategory";
import { isHomepageGeniusEligible } from "../src/lib/homepageFeatured";
import { mergeEditedCategories } from "../src/lib/comboAdmin";
import { canViewCategory } from "../src/lib/access";
import { resolveMarket, isValidSelection } from "../src/lib/markets";
import { PREDICTION_CATEGORIES } from "../src/lib/enums";
import { planGoalsBackfill, type GoalsBackfillRow } from "./backfill-goals-category";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || detail === "" ? "" : `  (${JSON.stringify(detail)})`}`);
}
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ou = (line: number, direction: string) => ({ line, direction });

async function main() {
  // ── 1. What qualifies ───────────────────────────────────────────────────
  console.log("\n1. Qualification is by structured market only");
  check("Over 1.5 qualifies", isGoalsPrediction("OVER_UNDER", ou(1.5, "OVER")));
  check("Over 2.5 qualifies", isGoalsPrediction("OVER_UNDER", ou(2.5, "OVER")));
  check("the lines are exactly 1.5 and 2.5", same(GOALS_LINES.map(String), ["1.5", "2.5"]));
  const rejected: Array<[string, string, unknown]> = [
    ["Under 1.5", "OVER_UNDER", ou(1.5, "UNDER")],
    ["Under 2.5", "OVER_UNDER", ou(2.5, "UNDER")],
    ["Over 3.5", "OVER_UNDER", ou(3.5, "OVER")],
    ["Over 4.5", "OVER_UNDER", ou(4.5, "OVER")],
    ["Over 0.5", "OVER_UNDER", ou(0.5, "OVER")],
    ["Over 2 (whole line)", "OVER_UNDER", ou(2, "OVER")],
    ["TEAM_TOTAL home Over 1.5 (team to score 2+)", "TEAM_TOTAL", { side: "HOME", line: 1.5, direction: "OVER" }],
    ["TEAM_TOTAL away Over 2.5", "TEAM_TOTAL", { side: "AWAY", line: 2.5, direction: "OVER" }],
    ["BTTS Yes", "BTTS", { value: "YES" }],
    ["Match Winner", "MATCH_WINNER", { value: "HOME" }],
    ["Double Chance", "DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }],
    ["Same-game double (even with an O/U leg)", "SAME_GAME_DOUBLE", { legIds: ["a", "b"] }],
    ["OTHER carrying an O/U-shaped selection", "OTHER", ou(2.5, "OVER")],
    ["malformed: null selection", "OVER_UNDER", null],
    ["malformed: line as a string", "OVER_UNDER", { line: "2.5", direction: "OVER" }],
    ["malformed: missing direction", "OVER_UNDER", { line: 2.5 }],
    ["malformed: missing line", "OVER_UNDER", { direction: "OVER" }],
    ["malformed: lower-case direction", "OVER_UNDER", { line: 2.5, direction: "over" }],
    ["malformed: not an object", "OVER_UNDER", "Over 2.5 Goals"],
    ["null marketType", null as unknown as string, ou(2.5, "OVER")],
  ];
  for (const [why, mt, sel] of rejected) check(`does not qualify: ${why}`, !isGoalsPrediction(mt, sel));

  // ── 2. Deterministic tagging ─────────────────────────────────────────────
  console.log("\n2. The tag follows the market");
  const over25 = { marketType: "OVER_UNDER", selection: ou(2.5, "OVER") };
  const over15 = { marketType: "OVER_UNDER", selection: ou(1.5, "OVER") };
  const under25 = { marketType: "OVER_UNDER", selection: ou(2.5, "UNDER") };
  const winner = { marketType: "MATCH_WINNER", selection: { value: "HOME" } };
  check("qualifying row gains GOALS", same(withGoalsCategory(["FEATURED"], over25), ["FEATURED", GOALS]));
  check("GOALS goes last, so the primary category is unchanged", withGoalsCategory([GOALS, "GENIUS", "VIP"], over15)[0] === "GENIUS");
  check("non-qualifying row never gets GOALS", same(withGoalsCategory(["FEATURED"], under25), ["FEATURED"]));
  check("a stale GOALS is removed when the market no longer qualifies", same(withGoalsCategory(["FEATURED", GOALS], winner), ["FEATURED"]));
  check("other tags are never touched", same(withGoalsCategory(["BANKER", "VIP", "PREMIUM", "BET_OF_THE_DAY"], over25), ["BANKER", "VIP", "PREMIUM", "BET_OF_THE_DAY", GOALS]));
  check("idempotent", same(withGoalsCategory(withGoalsCategory(["FEATURED"], over25), over25), ["FEATURED", GOALS]));
  check("duplicates collapse", same(withGoalsCategory(["FEATURED", "FEATURED", GOALS, GOALS], over25), ["FEATURED", GOALS]));
  check("a same-game-double source leg never gets GOALS", same(withGoalsCategory(["SAME_GAME_DOUBLE"], over25), ["SAME_GAME_DOUBLE"]));
  check("a double row never gets GOALS", same(withGoalsCategory(["SAME_GAME_DOUBLE", "FEATURED"], { marketType: "SAME_GAME_DOUBLE", selection: { legIds: ["a", "b"] } }), ["SAME_GAME_DOUBLE", "FEATURED"]));
  check("a row held only by GOALS that stops qualifying resolves to no category (the caller must refuse)", withGoalsCategory([GOALS], winner).length === 0);

  // ── 3. Admin edits ──────────────────────────────────────────────────────
  console.log("\n3. Admin edits add and remove GOALS");
  // The PATCH route: merge the editor's choice, then derive GOALS from the
  // market the row will hold after the patch.
  const save = (held: string[], requested: string[] | null, market: { marketType: string; selection: unknown }) => {
    const merged = requested ? mergeEditedCategories(held, requested) : { ok: true as const, categories: held };
    if (!merged.ok) return null;
    return withGoalsCategory(merged.categories, market);
  };
  check("editing Over 2.5 -> Match Winner removes GOALS", same(save(["FEATURED", GOALS], null, winner)!, ["FEATURED"]));
  check("editing Match Winner -> Over 1.5 adds GOALS", same(save(["GENIUS"], null, over15)!, ["GENIUS", GOALS]));
  check("editing Over 2.5 -> Under 2.5 removes GOALS", same(save(["FEATURED", GOALS], null, under25)!, ["FEATURED"]));
  check("editing Over 1.5 -> Over 2.5 keeps GOALS", same(save(["FEATURED", GOALS], null, over25)!, ["FEATURED", GOALS]));
  check("a category-only save on a Goals row keeps GOALS though the editor never sends it", same(save(["FEATURED", GOALS], ["GENIUS"], over25)!, ["GENIUS", GOALS]));
  check("the editor still needs one editorial category", save(["FEATURED", GOALS], [], over25) === null);

  const patch = code("src/app/api/admin/predictions/[id]/route.ts");
  check("PATCH derives GOALS from the post-edit market", /effectiveMarket/.test(patch) && /data\.marketType === "OTHER" \? null : data\.selection/.test(patch));
  check("PATCH rewrites categories on a market edit even when categories were not sent", /marketEdited \? heldCategories : null/.test(patch));
  check("PATCH passes that market to the category write", /setPredictionCategories\(params\.id, categoriesToWrite, effectiveMarket\)/.test(patch));
  check("PATCH refuses an edit that would leave no category, before writing", patch.indexOf("At least one category is required") < patch.indexOf("setPredictionCategories("));
  const patchSchema = /categories: z\.array\(z\.enum\(\[([^\]]*)\]\)\)/.exec(patch)?.[1] ?? "";
  check("GOALS cannot be ticked through the PATCH schema", patchSchema.length > 0 && !patchSchema.includes("GOALS"));
  const bulk = code("src/app/api/admin/predictions/bulk/route.ts");
  check("GOALS cannot be bulk-assigned", /assignableCategory = z\.enum\(\[[^\]]*\]\)/.test(bulk) && !/assignableCategory = z\.enum\(\[[^\]]*GOALS/.test(bulk));
  const editor = code("src/app/admin/predictions/[id]/page.tsx");
  check("the single-row editor never loads GOALS into its form", /c !== GOALS/.test(editor));

  // ── 4. Every category writer goes through the derivation ─────────────────
  console.log("\n4. One place derives the tag");
  const predictions = code("src/lib/predictions.ts");
  check("setPredictionCategories applies withGoalsCategory", /const unique = withGoalsCategory\(categories, resolvedMarket\)/.test(predictions));
  check("setPredictionCategories reads the stored market when none is passed", /market \?\?\s*\(await prisma\.prediction\.findUnique/.test(predictions));
  check("generation passes the persisted market", /setPredictionCategories\(pred\.id, persistedCategories, \{ marketType, selection \}\)/.test(code("src/lib/ai/generate.ts")));
  check("a rewrite re-derives from its new market", /setPredictionCategories\(predictionId, updated\.categories\.map\(\(c\) => c\.category\), updated\)/.test(code("src/lib/ai/rewrite.ts")));
  check("bulk category edits pass the row's market", /setPredictionCategories\(row\.id, next, row\)/.test(bulk));
  const writers = ["src/lib/geniusCuration.ts", "src/lib/betOfTheDay.ts"];
  for (const w of writers) check(`${w} writes only its own tag (cannot touch GOALS)`, !/GOALS/.test(read(w)));

  // ── 5. The feed ─────────────────────────────────────────────────────────
  console.log("\n5. The Goals feed");
  const row = (id: string, marketType: string, selection: unknown, tags: string[] = ["FEATURED", GOALS]) => ({
    id, marketType, selection, categories: tags.map((category) => ({ category })),
  });
  const mixed = [
    row("o15", "OVER_UNDER", ou(1.5, "OVER")),
    row("o25", "OVER_UNDER", ou(2.5, "OVER")),
    row("u25-mistagged", "OVER_UNDER", ou(2.5, "UNDER")),
    row("o35-mistagged", "OVER_UNDER", ou(3.5, "OVER")),
    row("tt-mistagged", "TEAM_TOTAL", { side: "HOME", line: 1.5, direction: "OVER" }),
    row("btts-mistagged", "BTTS", { value: "YES" }),
    row("mw-mistagged", "MATCH_WINNER", { value: "HOME" }),
    row("combo-mistagged", "SAME_GAME_DOUBLE", { legIds: ["a", "b"] }, ["SAME_GAME_DOUBLE", GOALS]),
    row("leg-mistagged", "OVER_UNDER", ou(2.5, "OVER"), ["SAME_GAME_DOUBLE", GOALS]),
    row("malformed", "OVER_UNDER", { line: 2.5 }),
  ];
  check("feed returns only Over 1.5 / Over 2.5 singles, whatever the tags say", same(goalsFeedRows(mixed).map((r) => r.id), ["o15", "o25"]));

  const { CATEGORY_SLUGS, CATEGORY_TO_SLUG, CATEGORY_NAMES, CATEGORY_CHIP_LABELS, CATEGORY_BLURBS, feedDayHref, parseFeedDay, dayShowsOutcomes, FEED_DAYS } =
    await import("../src/lib/categoryPredictions");
  check("/predictions/goals resolves to GOALS", CATEGORY_SLUGS.goals === "GOALS" && CATEGORY_TO_SLUG.GOALS === "goals");
  check("category name and chip read Goals", CATEGORY_NAMES.GOALS === "Goals" && CATEGORY_CHIP_LABELS.GOALS === "Goals");
  check("blurb names both lines", /Over 1\.5/.test(CATEGORY_BLURBS.GOALS) && /Over 2\.5/.test(CATEGORY_BLURBS.GOALS));
  check("Yesterday / Today / Tomorrow are the feed days", same(FEED_DAYS, ["yesterday", "today", "tomorrow"]));
  check("today is the bare path", feedDayHref("goals", "today") === "/predictions/goals");
  check("yesterday and tomorrow are query states", feedDayHref("goals", "yesterday") === "/predictions/goals?date=yesterday" && feedDayHref("goals", "tomorrow") === "/predictions/goals?date=tomorrow");
  check("only yesterday carries result chips", dayShowsOutcomes(parseFeedDay("yesterday")) && !dayShowsOutcomes(parseFeedDay("today")) && !dayShowsOutcomes(parseFeedDay("tomorrow")));
  const feeds = code("src/lib/categoryPredictions.ts");
  check("GOALS feed is scoped by the same Lagos-day kickoff bounds as every feed", /kickoff: \{ gte: today\.start, lt: today\.end \}/.test(feeds) && !/cat === "GOALS"[^}]*kickoff/.test(feeds));
  check("GOALS feed requires the tag, the market and no leg tag", /cat === "GOALS"\s*\?\s*\{ marketType: "OVER_UNDER", categories: \{ some: \{ category: "GOALS" \}, none: \{ category: "SAME_GAME_DOUBLE" \} \} \}/.test(feeds));
  check("GOALS feed re-filters and keeps display ordering", /const rows = cat === "GOALS" \? goalsFeedRows\(found\) : found;/.test(feeds) && /return orderForDisplay\(rows\)/.test(feeds));

  // ── 6. Product surfaces ─────────────────────────────────────────────────
  console.log("\n6. Product surfaces");
  // Dynamic: trackRecord calls react.cache at module load, after the shim above.
  const { TRACK_RECORD_CATEGORIES } = await import("../src/lib/trackRecord");
  check("GOALS is a known category", (PREDICTION_CATEGORIES as readonly string[]).includes(GOALS));
  check("Goals is public to anonymous visitors", canViewCategory("GOALS", null, null, null));
  check("Goals appears in the track record", (TRACK_RECORD_CATEGORIES as readonly string[]).includes(GOALS) && /GOALS: "Goals"/.test(read("src/components/TrackRecordView.tsx")));
  check("Goals is on the predictions index", /slug: "goals", name: "Goals", desc: CATEGORY_BLURBS\.GOALS/.test(read("src/app/(public)/predictions/page.tsx")));
  check("Goals is in the tips navigation", /href: "\/predictions\/goals", label: "Goals"/.test(read("src/components/Nav.tsx")));
  check("Goals is a back-button root", /"\/predictions\/goals"/.test(read("src/components/BackButton.tsx")));
  check("Goals has its own SEO title and phrase", /cat === "GOALS" \? "Over 1\.5 & Over 2\.5 Goals Predictions"/.test(read("src/app/(public)/predictions/[category]/page.tsx")));
  check("admin list can filter by GOALS", /"BET_OF_THE_DAY", "GOALS"\]\.map/.test(read("src/app/admin/predictions/page.tsx")));

  // ── 7. Nothing else moves ───────────────────────────────────────────────
  console.log("\n7. Existing behaviour is unaffected");
  check("existing slugs unchanged", same(Object.keys(CATEGORY_SLUGS), ["featured", "genius", "today", "banker", "vip", "premium", "bet-of-the-day", "combo-bets", "goals"]));
  check("VIP still needs an active VIP/Premium subscription", !canViewCategory("VIP", null, null, null) && canViewCategory("VIP", "VIP", "ACTIVE", "USER") && !canViewCategory("VIP", "VIP", "EXPIRED", "USER"));
  check("PREMIUM still needs an active Premium subscription", !canViewCategory("PREMIUM", "VIP", "ACTIVE", "USER") && canViewCategory("PREMIUM", "PREMIUM", "ACTIVE", "USER"));
  check("BANKER still needs a login", !canViewCategory("BANKER", null, null, null) && canViewCategory("BANKER", null, null, "USER"));
  check("FEATURED, GENIUS, TODAY, BET_OF_THE_DAY, SAME_GAME_DOUBLE still public", (["FEATURED", "GENIUS", "TODAY", "BET_OF_THE_DAY", "SAME_GAME_DOUBLE"] as const).every((c) => canViewCategory(c, null, null, null)));
  check("the homepage is not given a Goals section", !/GOALS|\/predictions\/goals/.test(code("src/app/(public)/page.tsx")));
  check("notifications digest is unchanged (no Goals section)", !/GOALS/.test(read("src/lib/notificationDigest.ts")));
  const legs = new Map<string, { marketType: string; selection: unknown }>();
  const genius = (id: string, marketType: string, selection: unknown) => ({ id, marketType, selection, confidence: 80 });
  check("homepage Genius still excludes a Goals-tagged Over 2.5", !isHomepageGeniusEligible(genius("o25", "OVER_UNDER", ou(2.5, "OVER")), legs));
  check("homepage Genius still excludes Under 2.5", !isHomepageGeniusEligible(genius("u25", "OVER_UNDER", ou(2.5, "UNDER")), legs));
  check("homepage Genius rule unchanged for Over 1.5 (eligible, as before)", isHomepageGeniusEligible(genius("o15", "OVER_UNDER", ou(1.5, "OVER")), legs));
  check("homepageFeatured.ts does not know about GOALS", !/GOALS|goalsCategory/.test(read("src/lib/homepageFeatured.ts")));

  // Settlement reads the market, never the tag.
  check("settlement code never reads GOALS", !/GOALS|goalsCategory/.test(read("src/lib/settlement.ts")) && !/GOALS|goalsCategory/.test(read("src/app/api/admin/settle/route.ts")) && !/GOALS/.test(read("src/lib/markets.ts")));
  const settle = (line: number, h: number, a: number) => resolveMarket("OVER_UNDER", ou(line, "OVER") as never, h, a);
  check("Over 1.5 settles as before: 1-1 WON, 1-0 LOST", settle(1.5, 1, 1) === "WON" && settle(1.5, 1, 0) === "LOST");
  check("Over 2.5 settles as before: 2-1 WON, 1-1 LOST, 0-0 LOST", settle(2.5, 2, 1) === "WON" && settle(2.5, 1, 1) === "LOST" && settle(2.5, 0, 0) === "LOST");
  check("qualifying selections are ordinary valid O/U selections", isValidSelection("OVER_UNDER", ou(1.5, "OVER")) && isValidSelection("OVER_UNDER", ou(2.5, "OVER")));

  // ── 8. Backfill plan ────────────────────────────────────────────────────
  console.log("\n8. Historical backfill plan");
  const b = (id: string, marketType: string, selection: unknown, tags: string[], status = "PUBLISHED"): GoalsBackfillRow => ({
    id, status, marketType, selection, categories: tags.map((category) => ({ category })),
  });
  const history = [
    b("o25", "OVER_UNDER", ou(2.5, "OVER"), ["FEATURED"]),
    b("o15", "OVER_UNDER", ou(1.5, "OVER"), ["GENIUS"]),
    b("o25-done", "OVER_UNDER", ou(2.5, "OVER"), ["FEATURED", GOALS]),
    b("u25", "OVER_UNDER", ou(2.5, "UNDER"), ["FEATURED"]),
    b("o35", "OVER_UNDER", ou(3.5, "OVER"), ["FEATURED"]),
    b("leg", "OVER_UNDER", ou(2.5, "OVER"), ["SAME_GAME_DOUBLE"]),
    b("stale", "MATCH_WINNER", { value: "HOME" }, ["FEATURED", GOALS]),
  ];
  const plan = planGoalsBackfill(history);
  check("adds only qualifying rows missing the tag", same(plan.add.map((r) => r.id), ["o25", "o15"]));
  check("removes only rows holding a tag their market does not justify", same(plan.remove.map((r) => r.id), ["stale"]));
  const after = history.map((r) => {
    const tags = r.categories.map((c) => c.category);
    const next = plan.add.includes(r) ? [...tags, GOALS] : plan.remove.includes(r) ? tags.filter((t) => t !== GOALS) : tags;
    return { ...r, categories: next.map((category) => ({ category })) };
  });
  const again = planGoalsBackfill(after);
  check("idempotent: a second run finds nothing", again.add.length === 0 && again.remove.length === 0);
  const backfill = code("scripts/backfill-goals-category.ts");
  check("backfill writes only GOALS category links", !/prisma\.prediction\.(update|updateMany|upsert|delete)/.test(backfill) && /category: GOALS/.test(backfill));
  check("backfill never touches outcome", !/outcome/.test(backfill));
  check("backfill is a dry run on a read-only session unless --apply", /apply \? url : readOnlyUrl\(url\)/.test(backfill) && /process\.argv\.includes\("--apply"\)/.test(backfill));

  console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
