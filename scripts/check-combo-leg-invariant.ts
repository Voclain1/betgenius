/**
 * Asserts the hidden combo-leg category invariant (src/lib/comboLegs.ts).
 *
 * A hidden leg — a single-market row filed under SAME_GAME_DOUBLE as part of a
 * Combo Bet — carries SAME_GAME_DOUBLE and nothing else. Audited 27 Sep 2026,
 * 199 legs had leaked into GENIUS, BANKER, VIP, PREMIUM, FEATURED and
 * BET_OF_THE_DAY through the admin category tools and Bet of the Day
 * auto-selection, and surfaced as loose picks in those feeds.
 *
 * Pins: the canonical categories, stickiness, the legacy live exception, every
 * write path (central helper, admin single and bulk, Bet of the Day), the one
 * defensive feed read, the cleanup plan and the drift classification.
 *
 * Pure: no database, no network. Run: npx tsx scripts/check-combo-leg-invariant.ts
 */
export {};
import { readFileSync, readdirSync, statSync } from "node:fs";

const react = require("react");
react.cache = (fn: any) => fn;

import {
  SAME_GAME_DOUBLE,
  HIDDEN_LEG_CUTOVER,
  HIDDEN_LEG_MESSAGE,
  isHiddenComboLeg,
  isLegacyLiveHiddenLeg,
  withHiddenLegCategories,
  hiddenLegCategoryEditError,
  tagFeedHiddenLegExclusion,
  HIDDEN_LEG_EXCLUSION,
  visibleInTagFeed,
  planHiddenLegCleanup,
  classifyLegDrift,
  type LegCategoryRow,
} from "../src/lib/comboLegs";
import { withGoalsCategory, GOALS } from "../src/lib/goalsCategory";
import { PREDICTION_CATEGORIES } from "../src/lib/enums";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || detail === "" ? "" : `  (${JSON.stringify(detail)})`}`);
}
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ou = (line: number, direction: string) => ({ line, direction });
const SGD = SAME_GAME_DOUBLE;
const BEFORE = new Date(HIDDEN_LEG_CUTOVER.getTime() - 86_400_000);
const AFTER = new Date(HIDDEN_LEG_CUTOVER.getTime() + 60_000);

async function main() {
  // ── 1. Canonical categories ──────────────────────────────────────────────
  console.log("\n1. A hidden leg resolves to exactly [SAME_GAME_DOUBLE]");
  check("new hidden leg + GENIUS => only SAME_GAME_DOUBLE", same(withHiddenLegCategories([SGD, "GENIUS"], "DOUBLE_CHANCE"), [SGD]));
  for (const t of ["BANKER", "VIP", "PREMIUM", "FEATURED", "TODAY", "GOALS", "BET_OF_THE_DAY"]) {
    check(`new hidden leg + ${t} => only SAME_GAME_DOUBLE`, same(withHiddenLegCategories([SGD, t], "BTTS"), [SGD]));
  }
  const others = PREDICTION_CATEGORIES.filter((c) => c !== SGD);
  check("every category but SAME_GAME_DOUBLE is refused on a leg (future categories included)", same(withHiddenLegCategories([SGD, ...others], "MATCH_WINNER"), [SGD]));
  check("the editorial tag first still yields SAME_GAME_DOUBLE as primary", withHiddenLegCategories(["GENIUS", SGD], "OVER_UNDER")[0] === SGD);
  check("sticky: dropping SAME_GAME_DOUBLE from an existing leg is canonicalised back", same(withHiddenLegCategories(["GENIUS"], "OVER_UNDER", [SGD, "GENIUS"]), [SGD]));
  check("sticky: an empty write on an existing leg stays a leg", same(withHiddenLegCategories([], "OVER_UNDER", [SGD]), [SGD]));
  check("ordinary prediction categories unchanged", same(withHiddenLegCategories(["FEATURED", "GENIUS", "VIP"], "MATCH_WINNER", ["FEATURED"]), ["FEATURED", "GENIUS", "VIP"]));
  check("a parent SAME_GAME_DOUBLE keeps its editorial tags", same(withHiddenLegCategories([SGD, "GENIUS", "VIP"], "SAME_GAME_DOUBLE", [SGD]), [SGD, "GENIUS", "VIP"]));
  check("Goals still derived for ordinary rows", same(withHiddenLegCategories(withGoalsCategory(["FEATURED"], { marketType: "OVER_UNDER", selection: ou(2.5, "OVER") }), "OVER_UNDER"), ["FEATURED", GOALS]));
  check("Goals never reaches a leg", same(withHiddenLegCategories(withGoalsCategory([SGD, GOALS], { marketType: "OVER_UNDER", selection: ou(1.5, "OVER") }), "OVER_UNDER"), [SGD]));
  check("isHiddenComboLeg: single + SGD tag is a leg, the double is not, an untagged single is not",
    isHiddenComboLeg("BTTS", [SGD]) && !isHiddenComboLeg("SAME_GAME_DOUBLE", [SGD, "GENIUS"]) && !isHiddenComboLeg("BTTS", ["GENIUS"]));

  // ── 2. Legacy live exception ─────────────────────────────────────────────
  console.log("\n2. Legacy live exception (time-based)");
  const leg = (over: Partial<LegCategoryRow> = {}): LegCategoryRow => ({
    id: "l", marketType: "DOUBLE_CHANCE", category: SGD, categories: [SGD, "GENIUS"], createdAt: BEFORE, status: "PUBLISHED", outcome: "PENDING", ...over,
  });
  check("pre-cutover, PUBLISHED, unsettled => exception", isLegacyLiveHiddenLeg("DOUBLE_CHANCE", leg()));
  check("created after the cutover => no exception", !isLegacyLiveHiddenLeg("DOUBLE_CHANCE", leg({ createdAt: AFTER })));
  check("settled => no exception (it stops qualifying)", !isLegacyLiveHiddenLeg("DOUBLE_CHANCE", leg({ outcome: "WON" })));
  check("awaiting review => no exception", !isLegacyLiveHiddenLeg("DOUBLE_CHANCE", leg({ status: "PENDING_REVIEW" })));
  check("not a leg => no exception", !isLegacyLiveHiddenLeg("DOUBLE_CHANCE", leg({ categories: ["GENIUS"] })));

  // ── 3. The central write ─────────────────────────────────────────────────
  console.log("\n3. setPredictionCategories applies the invariant");
  const preds = code("src/lib/predictions.ts");
  const setFn = preds.slice(preds.indexOf("export async function setPredictionCategories"), preds.indexOf("export type ReviewAction"));
  check("reads the row's persisted links (stickiness)", /categories: \{ select: \{ category: true \} \}/.test(setFn) && /const held = persisted\?\.categories\.map/.test(setFn));
  check("a legacy live leg returns before any write", /if \(persisted && isLegacyLiveHiddenLeg\(resolvedMarket\.marketType, \{ \.\.\.persisted, categories: held \}\)\) return;/.test(setFn) && setFn.indexOf("isLegacyLiveHiddenLeg(") < setFn.indexOf("$transaction"));
  check("the invariant is applied after Goals derivation, before the write", /const derived = [^;]*withGoalsCategory\(categories, resolvedMarket\);/.test(setFn) && /const unique = withHiddenLegCategories\(derived, resolvedMarket\.marketType, held\);/.test(setFn) && setFn.indexOf("withHiddenLegCategories(") < setFn.indexOf("$transaction"));

  // Every category-link writer goes through setPredictionCategories, except
  // curation (which excludes legs) and Bet of the Day (guarded below).
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = `${dir}/${f}`; return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
  const src = walk("src");
  const linkWriters = src.filter((f) => /predictionCategoryLink\.(create|createMany|upsert|update|updateMany)\(|categories: \{ create|connectOrCreate/.test(read(f)));
  check("category links are written only by predictions.ts, curation and Bet of the Day",
    same(linkWriters.map((f) => f.replace(/\\/g, "/")).sort(), ["src/lib/betOfTheDay.ts", "src/lib/geniusCuration.ts", "src/lib/predictions.ts"]), linkWriters);
  check("curation's candidate query still excludes hidden legs", /NOT: \{\s*marketType: \{ not: "SAME_GAME_DOUBLE" \},\s*categories: \{ some: \{ category: "SAME_GAME_DOUBLE" \} \},\s*\}/.test(code("src/lib/geniusCuration.ts")));
  const replaceWriters = src.filter((f) => /setPredictionCategories\(/.test(read(f)) && !f.endsWith("lib/predictions.ts"));
  check("replace-style writers all call setPredictionCategories (generation, rewrite, assembly, VIP gate, admin routes)",
    ["src/lib/ai/generate.ts", "src/lib/ai/rewrite.ts", "src/lib/sameGameDoubleAssembly.ts", "src/lib/vipPremiumPipeline.ts", "src/app/api/admin/predictions/route.ts", "src/app/api/admin/predictions/[id]/route.ts", "src/app/api/admin/predictions/bulk/route.ts"]
      .every((f) => replaceWriters.map((x) => x.replace(/\\/g, "/")).includes(f)), replaceWriters);

  // ── 4. Admin ─────────────────────────────────────────────────────────────
  console.log("\n4. Admin tools");
  check("single edit: tagging a leg is refused", hiddenLegCategoryEditError("BTTS", [SGD], ["GENIUS"]) === HIDDEN_LEG_MESSAGE);
  check("single edit: a leg save with no categories is fine", hiddenLegCategoryEditError("BTTS", [SGD], []) === null && hiddenLegCategoryEditError("BTTS", [SGD], [SGD]) === null);
  check("single edit: ordinary rows unaffected", hiddenLegCategoryEditError("BTTS", ["FEATURED"], ["GENIUS"]) === null);
  const patch = code("src/app/api/admin/predictions/[id]/route.ts");
  check("PATCH refuses a leg category edit with 400 before writing anything", /const legEditError = categories \? hiddenLegCategoryEditError\(before\.marketType, held, categories\) : null;\s*if \(legEditError\) return NextResponse\.json\(\{ error: legEditError \}, \{ status: 400 \}\);/.test(patch) && patch.indexOf("legEditError) return") < patch.indexOf("setPredictionCategories("));
  const bulk = code("src/app/api/admin/predictions/bulk/route.ts");
  check("bulk explicitly refuses hidden legs (ok:false with the message), before any write", /if \(isHiddenComboLeg\(row\.marketType, current\)\) \{\s*results\.push\(\{ id: row\.id, ok: false, error: HIDDEN_LEG_MESSAGE \}\);\s*continue;\s*\}/.test(bulk) && bulk.indexOf("isHiddenComboLeg(") < bulk.indexOf("applyCategoryChanges("));
  const editor = code("src/app/admin/predictions/[id]/page.tsx");
  check("editor: no checkboxes for a hidden leg, the message instead", /\{isHiddenLeg \? \(\s*<div className="md:col-span-2">\s*<div className="mb-1 text-sm">Categories<\/div>\s*<p className="text-sm text-gray-400">\{HIDDEN_LEG_MESSAGE\}<\/p>/.test(editor));
  check("editor: a leg save sends no categories", /\.\.\.\(hiddenLeg \? \{\} : \{ categories: form\.categories \}\)/.test(editor));
  check("the message reads as specified", HIDDEN_LEG_MESSAGE === "Part of a Combo Bet — not independently categorised");

  // ── 5. Bet of the Day ────────────────────────────────────────────────────
  console.log("\n5. Bet of the Day");
  const botd = code("src/lib/betOfTheDay.ts");
  const candidates = botd.slice(botd.indexOf("export async function getBetOfTheDayCandidates"), botd.indexOf("export type AutoSelectResult"));
  check("candidate query excludes every hidden leg", /\.\.\.HIDDEN_LEG_EXCLUSION,/.test(candidates));
  check("HIDDEN_LEG_EXCLUSION has no legacy exception", JSON.stringify(HIDDEN_LEG_EXCLUSION) === JSON.stringify({ NOT: { marketType: { not: SGD }, categories: { some: { category: SGD } } } }));
  const pin = botd.slice(botd.indexOf("export async function setBetOfTheDay"), botd.indexOf("export async function hasManualPinToday"));
  check("setBetOfTheDay rejects a hidden leg before its transaction", /if \(target && isHiddenComboLeg\(target\.marketType, target\.categories\.map\(\(c\) => c\.category\)\)\) throw new HiddenComboLegError\(\);/.test(pin) && pin.indexOf("HiddenComboLegError()") < pin.indexOf("$transaction"));
  check("a manual pin of a leg returns 400", /if \(error instanceof HiddenComboLegError\) return NextResponse\.json\(\{ error: error\.message \}, \{ status: 400 \}\);/.test(patch));
  check("selection criteria otherwise untouched (the odds gate call is unchanged)", /qualifiesForBetOfDay\(\{ odds, marketType: r\.marketType, selection: r\.selection, confidence: r\.confidence \}\)/.test(botd));

  // ── 6. Category feeds ────────────────────────────────────────────────────
  console.log("\n6. Category feeds (the one defensive read)");
  const { TAG_FEEDS_EXCLUDING_LEGS } = await import("../src/lib/categoryPredictions");
  check("every category but Today, Combo Bets and Goals (which filter legs themselves) excludes legs — new categories included",
    same([...TAG_FEEDS_EXCLUDING_LEGS].sort(), PREDICTION_CATEGORIES.filter((c) => !["TODAY", "SAME_GAME_DOUBLE", "GOALS"].includes(c)).sort()));
  check("getCategoryPredictions applies it", /\.\.\.\(TAG_FEEDS_EXCLUDING_LEGS\.has\(cat\) \? tagFeedHiddenLegExclusion\(\) : \{\}\),/.test(code("src/lib/categoryPredictions.ts")));
  check("the Prisma filter matches the predicate (legs, minus pre-cutover live ones)", JSON.stringify(tagFeedHiddenLegExclusion()) === JSON.stringify({
    NOT: { marketType: { not: SGD }, categories: { some: { category: SGD } }, NOT: { createdAt: { lt: HIDDEN_LEG_CUTOVER }, status: "PUBLISHED", outcome: "PENDING" } },
  }));
  const feedRow = (over: Partial<LegCategoryRow>) => leg({ ...over });
  check("post-cutover leaked leg is blocked from tag feeds", !visibleInTagFeed(feedRow({ createdAt: AFTER })));
  check("pre-cutover live legacy leg stays visible until settlement", visibleInTagFeed(feedRow({})));
  check("...and is blocked once settled", !visibleInTagFeed(feedRow({ outcome: "WON" })));
  check("ordinary rows and doubles stay visible", visibleInTagFeed(feedRow({ categories: ["GENIUS"] })) && visibleInTagFeed(feedRow({ marketType: "SAME_GAME_DOUBLE", createdAt: AFTER })));
  check("homepage, digest and track record carry no new leg filter (out of scope)",
    !/comboLegs/.test(read("src/app/(public)/page.tsx")) && !/comboLegs/.test(read("src/lib/dailyDigests.ts")) && !/comboLegs/.test(read("src/lib/notificationDigest.ts")) && !/comboLegs/.test(read("src/lib/trackRecord.ts")));

  // ── 7. Cleanup ───────────────────────────────────────────────────────────
  console.log("\n7. Cleanup plan (scripts/backfill-hidden-leg-categories.ts)");
  const rows: LegCategoryRow[] = [
    leg({ id: "live-genius", categories: [SGD, "GENIUS"] }),
    leg({ id: "live-primary", category: "BANKER", categories: [SGD, "BANKER", "GENIUS"] }),
    leg({ id: "won-genius", outcome: "WON", categories: [SGD, "GENIUS", "BANKER"] }),
    leg({ id: "lost-primary", outcome: "LOST", category: "GENIUS", categories: [SGD, "GENIUS"] }),
    leg({ id: "archived", status: "ARCHIVED", categories: [SGD, "FEATURED"] }),
    leg({ id: "review", status: "PENDING_REVIEW", categories: [SGD, "VIP", "PREMIUM"] }),
    leg({ id: "botd", outcome: "LOST", categories: [SGD, "GENIUS", "BET_OF_THE_DAY"] }),
    leg({ id: "clean", categories: [SGD] }),
    leg({ id: "double", marketType: "SAME_GAME_DOUBLE", categories: [SGD, "GENIUS"] }),
    leg({ id: "single", categories: ["GENIUS"] }),
  ];
  const plan = planHiddenLegCleanup(rows);
  check("skips every PUBLISHED + unsettled leg", same(plan.skippedLive.map((r) => r.id), ["live-genius", "live-primary"]));
  check("handles settled / archived / unpublished legs", same(plan.eligible.map((e) => e.row.id), ["won-genius", "lost-primary", "archived", "review", "botd"]));
  check("removes only non-SGD links", plan.eligible.every((e) => !e.removeCategories.includes(SGD) && e.removeCategories.length === e.row.categories.length - 1));
  check("resets the primary only where it is not SGD", same(plan.eligible.filter((e) => e.resetPrimary).map((e) => e.row.id), ["lost-primary"]));
  check("clean legs, doubles and ordinary rows are not touched", ["clean", "double", "single"].every((id) => !plan.affected.some((r) => r.id === id)));
  const after = rows.map((r) => {
    const e = plan.eligible.find((x) => x.row.id === r.id);
    return e ? { ...r, categories: [SGD], category: SGD } : r;
  });
  const again = planHiddenLegCleanup(after);
  check("idempotent: a second run has nothing eligible, and skips the same live rows", again.eligible.length === 0 && same(again.skippedLive.map((r) => r.id), ["live-genius", "live-primary"]));
  const settledLater = planHiddenLegCleanup(after.map((r) => (r.id === "live-genius" ? { ...r, outcome: "WON" } : r)));
  check("a skipped live leg becomes eligible once it settles", settledLater.eligible.some((e) => e.row.id === "live-genius"));
  const script = code("scripts/backfill-hidden-leg-categories.ts");
  check("the script writes only non-SGD links and the primary column", /predictionCategoryLink\.deleteMany\(\{\s*where: \{ predictionId: \{ in: ids \}, category: \{ not: SAME_GAME_DOUBLE \}, prediction: \{ isNot: LIVE \} \},/.test(script) && /data: \{ category: SAME_GAME_DOUBLE \}/.test(script));
  check("the script repeats the live-row exclusion in both writes", /prediction: \{ isNot: LIVE \}/.test(script) && /NOT: LIVE \}, data:/.test(script) && /const LIVE = \{ status: "PUBLISHED", outcome: "PENDING" \} as const;/.test(script));
  check("the script never deletes a row or changes status/outcome/selection/market", !/prediction\.(delete|deleteMany|update|upsert)\(/.test(script) && !/(status|outcome|selection|market|settledAt|legIds)\s*:\s*[^}]*\}\s*,?\s*\}\)\s*[,\]]/.test(script.slice(script.indexOf("data:"))) && (script.match(/data: \{/g) ?? []).length === 1);
  check("the dry run is a read-only session unless --apply", /apply \? url : readOnlyUrl\(url\)/.test(script));

  // ── 8. Drift ─────────────────────────────────────────────────────────────
  console.log("\n8. Drift classification (scripts/check-hidden-leg-categories.ts)");
  check("post-cutover leaked leg => VIOLATION", classifyLegDrift(leg({ createdAt: AFTER })) === "VIOLATION");
  check("post-cutover leg with a non-SGD primary => VIOLATION", classifyLegDrift(leg({ createdAt: AFTER, categories: [SGD], category: "GENIUS" })) === "VIOLATION");
  check("post-cutover clean leg => CLEAN", classifyLegDrift(leg({ createdAt: AFTER, categories: [SGD] })) === "CLEAN");
  check("pre-cutover live leaked leg => allowed exception", classifyLegDrift(leg()) === "LEGACY_LIVE_EXCEPTION");
  check("...once settled => awaiting cleanup, no longer the exception", classifyLegDrift(leg({ outcome: "LOST" })) === "LEGACY_PENDING_CLEANUP");
  check("doubles and ordinary rows are never drift", classifyLegDrift(leg({ marketType: "SAME_GAME_DOUBLE", createdAt: AFTER })) === "CLEAN" && classifyLegDrift(leg({ categories: ["GENIUS"], createdAt: AFTER })) === "CLEAN");
  const drift = code("scripts/check-hidden-leg-categories.ts");
  check("drift check fails only on post-cutover violations", /if \(by\.VIOLATION\.length\) \{[\s\S]*?process\.exit\(1\);/.test(drift) && !/LEGACY_LIVE_EXCEPTION\.length\)\s*\{[^}]*exit/.test(drift) && !/LEGACY_PENDING_CLEANUP\.length\)\s*\{[^}]*exit/.test(drift));
  const { DB_READONLY_STEPS, PURE_STEPS } = await import("./lib/preflightSteps");
  check("drift check runs in preflight:db, this check in default preflight", DB_READONLY_STEPS.includes("tsx scripts/check-hidden-leg-categories.ts") && PURE_STEPS.includes("tsx scripts/check-combo-leg-invariant.ts"));
  check("the cutover is a fixed instant, not an id allowlist", HIDDEN_LEG_CUTOVER.toISOString() === "2026-09-30T23:00:00.000Z" && !/cm[a-z0-9]{20,}/.test(read("src/lib/comboLegs.ts")));

  console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
