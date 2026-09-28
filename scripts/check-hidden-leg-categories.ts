/**
 * Hidden combo legs carry SAME_GAME_DOUBLE and nothing else — checked against
 * the live database.
 *
 * The invariant is enforced on write (setPredictionCategories, the admin
 * routes, Bet of the Day; see src/lib/comboLegs.ts). This is the net under it:
 * any writer that bypasses those — a new route, a script, a raw query — shows
 * up here instead of as a leg surfacing in a public or paid feed.
 *
 * Cutover-aware, time-based (HIDDEN_LEG_CUTOVER), no id allowlist:
 *   FAIL  a leg created on or after the cutover with any category but
 *         SAME_GAME_DOUBLE, or a non-SGD primary — the invariant broke.
 *   ok    a pre-cutover leg still live (PUBLISHED, unsettled) carrying old
 *         tags — the deliberate legacy exception, frozen until it settles.
 *   warn  a pre-cutover leg no longer live that still carries old tags —
 *         waiting for scripts/backfill-hidden-leg-categories.ts. Settling is
 *         what moves a row here, so this is reported, not failed.
 *
 * READ-ONLY. Runs in preflight:db on a read-only Postgres session.
 *
 * Run: npx tsx --env-file=.env scripts/check-hidden-leg-categories.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

import { SAME_GAME_DOUBLE, HIDDEN_LEG_CUTOVER, classifyLegDrift, type LegCategoryRow } from "../src/lib/comboLegs";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  try {
    const raw = await prisma.prediction.findMany({
      where: { marketType: { not: SAME_GAME_DOUBLE }, categories: { some: { category: SAME_GAME_DOUBLE } } },
      select: { id: true, marketType: true, category: true, createdAt: true, status: true, outcome: true, categories: { select: { category: true } } },
    });
    const rows: LegCategoryRow[] = raw.map((r) => ({ ...r, categories: r.categories.map((c) => c.category) }));
    const by = { CLEAN: [] as LegCategoryRow[], LEGACY_LIVE_EXCEPTION: [] as LegCategoryRow[], LEGACY_PENDING_CLEANUP: [] as LegCategoryRow[], VIOLATION: [] as LegCategoryRow[] };
    for (const r of rows) by[classifyLegDrift(r)].push(r);

    console.log(`hidden combo legs: ${rows.length} (cutover ${HIDDEN_LEG_CUTOVER.toISOString()})`);
    console.log(`  clean:                                  ${by.CLEAN.length}`);
    console.log(`  ok    legacy live exception (frozen):   ${by.LEGACY_LIVE_EXCEPTION.length}`);
    console.log(`  warn  legacy, settled/non-live, awaiting backfill: ${by.LEGACY_PENDING_CLEANUP.length}`);
    console.log(`  FAIL  post-cutover violations:          ${by.VIOLATION.length}`);
    for (const r of by.VIOLATION) console.error(`    ${r.id}  created ${r.createdAt.toISOString()}  [${r.categories.join(", ")}]  primary ${r.category}`);
    if (by.LEGACY_PENDING_CLEANUP.length) console.log("  -> run scripts/backfill-hidden-leg-categories.ts (dry run first) to clean the legacy rows");

    if (by.VIOLATION.length) {
      console.error(`\nFAIL: ${by.VIOLATION.length} hidden leg(s) created after the cutover carry categories other than SAME_GAME_DOUBLE`);
      process.exit(1);
    }
    console.log("\nPASS: no hidden leg created after the cutover carries a category other than SAME_GAME_DOUBLE");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
