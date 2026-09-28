/**
 * Remove leaked editorial categories from hidden combo legs that are no longer
 * live.
 *
 * A hidden leg's only valid category is SAME_GAME_DOUBLE (src/lib/comboLegs.ts).
 * Before that was enforced, admin category tools and Bet of the Day
 * auto-selection left GENIUS, BANKER, VIP, PREMIUM, FEATURED and BET_OF_THE_DAY
 * on legs, which then surfaced as loose picks in those feeds.
 *
 * LIVE ROWS ARE SKIPPED. A leg that is PUBLISHED and unsettled keeps every link
 * and its primary category, whatever it carries, so no live pick leaves a
 * public or paid feed. It is reported separately; once it settles, a later run
 * cleans it.
 *
 * Deliberately narrow, for every other affected leg:
 *   - deletes its category links other than SAME_GAME_DOUBLE;
 *   - resets its primary `category` column to SAME_GAME_DOUBLE if needed.
 * Never deletes a leg or its SAME_GAME_DOUBLE link, and never touches status,
 * outcome, settlement fields, market, selection, leg ids or the parent double.
 * Idempotent: a second run finds nothing eligible.
 *
 * Dry run by default, on a read-only Postgres session — the dry run cannot
 * write even by accident. Writing requires --apply.
 *
 * Run: npx tsx --env-file=.env scripts/backfill-hidden-leg-categories.ts [--apply]
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

import { SAME_GAME_DOUBLE, planHiddenLegCleanup, type LegCategoryRow } from "../src/lib/comboLegs";

/** A live row: PUBLISHED and unsettled. Never written by this script. */
const LIVE = { status: "PUBLISHED", outcome: "PENDING" } as const;

const breakdown = (rows: readonly LegCategoryRow[]) =>
  rows.reduce<Record<string, number>>((acc, r) => {
    for (const c of r.categories.filter((c) => c !== SAME_GAME_DOUBLE)) acc[c] = (acc[c] ?? 0) + 1;
    if (r.category !== SAME_GAME_DOUBLE) acc[`primary:${r.category}`] = (acc[`primary:${r.category}`] ?? 0) + 1;
    return acc;
  }, {});

async function main() {
  const apply = process.argv.includes("--apply");
  const { PrismaClient } = await import("@prisma/client");
  const { readOnlyUrl } = await import("./lib/dbSafety");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ datasources: { db: { url: apply ? url : readOnlyUrl(url) } } });

  try {
    const raw = await prisma.prediction.findMany({
      where: { marketType: { not: SAME_GAME_DOUBLE }, categories: { some: { category: SAME_GAME_DOUBLE } } },
      select: { id: true, marketType: true, category: true, createdAt: true, status: true, outcome: true, categories: { select: { category: true } } },
    });
    const rows: LegCategoryRow[] = raw.map((r) => ({ ...r, categories: r.categories.map((c) => c.category) }));
    const plan = planHiddenLegCleanup(rows);
    const links = plan.eligible.reduce((n, e) => n + e.removeCategories.length, 0);
    const resets = plan.eligible.filter((e) => e.resetPrimary);

    console.log(`hidden legs scanned:                 ${rows.length}`);
    console.log(`affected (extra tag or non-SGD primary): ${plan.affected.length}`);
    console.log(`eligible for cleanup (not live):     ${plan.eligible.length}`, JSON.stringify(plan.eligible.reduce<Record<string, number>>((a, e) => ((a[e.row.status] = (a[e.row.status] ?? 0) + 1), a), {})));
    console.log(`  links that would be removed:       ${links}`, JSON.stringify(breakdown(plan.eligible.map((e) => ({ ...e.row, category: SAME_GAME_DOUBLE })))));
    console.log(`  primary categories to reset:       ${resets.length}`, JSON.stringify(resets.reduce<Record<string, number>>((a, e) => ((a[e.row.category] = (a[e.row.category] ?? 0) + 1), a), {})));
    console.log(`skipped — PUBLISHED and unsettled:   ${plan.skippedLive.length}  (no change)`, JSON.stringify(breakdown(plan.skippedLive)));
    for (const r of plan.skippedLive) console.log(`    skip ${r.id}  [${r.categories.join(", ")}]  primary ${r.category}`);

    if (apply && plan.eligible.length) {
      const ids = plan.eligible.map((e) => e.row.id);
      await prisma.$transaction([
        // The live-row exclusion is repeated in both writes, not only in the
        // plan: a leg published between planning and writing is still skipped.
        prisma.predictionCategoryLink.deleteMany({
          where: { predictionId: { in: ids }, category: { not: SAME_GAME_DOUBLE }, prediction: { isNot: LIVE } },
        }),
        ...(resets.length
          ? [prisma.prediction.updateMany({ where: { id: { in: resets.map((e) => e.row.id) }, NOT: LIVE }, data: { category: SAME_GAME_DOUBLE } })]
          : []),
      ]);
    }
    console.log(`\n${apply ? "APPLIED" : "DRY RUN (read-only session) — re-run with --apply to write"}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Guarded so the check suite can import this file without opening a connection.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
