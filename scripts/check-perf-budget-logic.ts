/**
 * Performance budgets (SEO-604): the pure logic, pinned without a build.
 * scripts/check-performance-budget.ts measures a real `.next` build in CI;
 * this proves the arithmetic it relies on: which chunks a page loads, which
 * budget applies, and what fails.
 *
 * Run: npx tsx scripts/check-perf-budget-logic.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateBudgets, firstLoadChunks, pageKeys, type AppBuildManifest, type Budgets } from "./lib/perfBudget";

let failures = 0;
let passed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) passed++;
  else failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

const manifest: AppBuildManifest = {
  pages: {
    "/layout": ["static/chunks/webpack.js", "static/chunks/main-app.js", "static/css/app.css"],
    "/(public)/layout": ["static/chunks/main-app.js", "static/chunks/public-layout.js"],
    "/(public)/predictions/layout": ["static/chunks/predictions-layout.js"],
    "/(public)/predictions/[category]/layout": ["static/chunks/category-layout.js"],
    "/(public)/predictions/[category]/page": ["static/chunks/category.js", "static/css/category.css"],
    "/(public)/odds-calculator/page": ["static/chunks/odds.js"],
    "/admin/layout": ["static/chunks/admin-layout.js"],
    "/api/predictions/results/route": ["static/chunks/route.js"],
  },
};

console.log("first-load chunks:");
eq("a nested page loads every layout above it, then its own chunks", firstLoadChunks(manifest, "/(public)/predictions/[category]/page"), [
  "static/chunks/category-layout.js",
  "static/chunks/category.js",
  "static/chunks/main-app.js",
  "static/chunks/predictions-layout.js",
  "static/chunks/public-layout.js",
  "static/chunks/webpack.js",
]);
check("CSS is not counted as JS", !firstLoadChunks(manifest, "/(public)/predictions/[category]/page").some((c) => c.endsWith(".css")));
check("a chunk shared by two layouts is counted once", firstLoadChunks(manifest, "/(public)/odds-calculator/page").filter((c) => c === "static/chunks/main-app.js").length === 1);
check("a sibling section's layout is not counted", !firstLoadChunks(manifest, "/(public)/odds-calculator/page").includes("static/chunks/admin-layout.js"));
eq("pages only: no layouts, no route handlers", pageKeys(manifest), ["/(public)/odds-calculator/page", "/(public)/predictions/[category]/page"]);

console.log("\njudging:");
const budgets: Budgets = { defaultKb: 160, sharedKb: 120, routes: { "/(public)/odds-calculator/page": 200 } };
const ok = evaluateBudgets({ "/(public)/predictions/[category]/page": 150, "/(public)/odds-calculator/page": 190 }, 110, budgets);
eq("everything within budget: no failures", ok.failures, []);
eq("rows heaviest first, each with its own budget", ok.rows.map((r) => [r.page, r.budgetKb]), [["/(public)/odds-calculator/page", 200], ["/(public)/predictions/[category]/page", 160]]);
const over = evaluateBudgets({ "/(public)/predictions/[category]/page": 160.4, "/(public)/odds-calculator/page": 190 }, 110, budgets);
eq("a page over the default budget fails", over.failures, ["/(public)/predictions/[category]/page: 160.4 KB > 160 KB budget"]);
check("exactly on budget passes", evaluateBudgets({ "/(public)/predictions/[category]/page": 160, "/(public)/odds-calculator/page": 1 }, 120, budgets).failures.length === 0);
const shared = evaluateBudgets({ "/(public)/predictions/[category]/page": 150, "/(public)/odds-calculator/page": 190 }, 121, budgets);
check("shared JS over its budget fails, even with every page inside", shared.sharedOver && shared.failures.length === 1 && shared.failures[0].startsWith("shared JS"));
const stale = evaluateBudgets({ "/(public)/predictions/[category]/page": 150 }, 110, budgets);
eq("an override for a page that no longer exists fails", stale.failures, ["budget override for /(public)/odds-calculator/page, which is not a page in this build"]);

console.log("\nwiring:");
const committed = JSON.parse(readFileSync(join(__dirname, "perf-budgets.json"), "utf8")) as Budgets;
check("committed budgets are positive numbers", committed.defaultKb > 0 && committed.sharedKb > 0 && committed.sharedKb <= committed.defaultKb);
const workflow = readFileSync(join(__dirname, "..", ".github/workflows/preflight.yml"), "utf8");
check("CI measures the budgets after the production build", workflow.indexOf("npm run check:budgets") > workflow.indexOf("npx next build"));

console.log(`\n${passed} passed, ${failures} failed`);
if (failures) process.exit(1);
console.log("All performance budget logic checks passed.");
