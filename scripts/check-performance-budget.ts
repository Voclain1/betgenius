/**
 * Performance budgets (SEO-604), against a real build: every page's
 * first-load JavaScript, gzipped, must stay inside scripts/perf-budgets.json.
 *
 * Run after `next build` (the preflight workflow does this in CI):
 *   npm run check:budgets
 *
 * A failure names the page and its size. Fix the weight (a client component
 * that should be a server one, a library pulled into a shared layout) rather
 * than the budget; raise a budget only for a page that genuinely needs it,
 * as a reviewed change to perf-budgets.json.
 */
export {};

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { evaluateBudgets, firstLoadChunks, pageKeys, type AppBuildManifest, type Budgets } from "./lib/perfBudget";

const root = join(__dirname, "..");
const next = join(root, ".next");
const manifestPath = join(next, "app-build-manifest.json");
if (!existsSync(manifestPath)) {
  console.error("No .next/app-build-manifest.json: run `next build` first.");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as AppBuildManifest;
const budgets = JSON.parse(readFileSync(join(__dirname, "perf-budgets.json"), "utf8")) as Budgets;

const gzCache = new Map<string, number>();
const kbOf = (chunks: string[]) =>
  chunks.reduce((sum, c) => {
    if (!gzCache.has(c)) gzCache.set(c, gzipSync(readFileSync(join(next, c)), { level: 9 }).length);
    return sum + gzCache.get(c)!;
  }, 0) / 1024;

const sizes: Record<string, number> = {};
for (const page of pageKeys(manifest)) sizes[page] = kbOf(firstLoadChunks(manifest, page));
const sharedKb = kbOf((manifest.pages["/layout"] ?? []).filter((c) => c.endsWith(".js")));

const { rows, failures } = evaluateBudgets(sizes, sharedKb, budgets);
console.log(`shared JS (root layout + framework): ${sharedKb.toFixed(1)} KB / ${budgets.sharedKb} KB`);
console.log("heaviest pages (first-load JS, gzipped):");
for (const r of rows.slice(0, 12)) console.log(`  ${r.over ? "OVER" : "ok  "}  ${r.kb.toFixed(1).padStart(6)} KB / ${r.budgetKb} KB  ${r.page}`);
console.log(`${rows.length} pages measured.`);

if (failures.length) {
  console.error(`\nFAIL — ${failures.length} budget${failures.length === 1 ? "" : "s"} exceeded:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log("All pages within their performance budgets.");
