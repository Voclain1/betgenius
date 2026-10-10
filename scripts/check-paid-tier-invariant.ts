/**
 * The VIP/PREMIUM paid-tier invariant, checked against the live database.
 *
 * Enforced on write by curation (planCuration in src/lib/geniusCuration.ts)
 * and by the dedicated pass's gate (applyVipPremiumGate). This is the net under
 * them: an admin edit, a script or a new writer that tags a paid pick outside
 * the rules shows up here instead of in a subscriber's feed.
 *
 * Every live (not archived) row tagged VIP or PREMIUM, hidden combo legs aside
 * (check-hidden-leg-categories.ts owns those):
 *   - VIP below 75, or PREMIUM below 80 — the tiers' hard floors;
 *   - a SAME_GAME_DOUBLE — never a paid pick;
 *   - a second paid pick on the same fixture, across VIP and PREMIUM together.
 *
 * Cutover-aware by KICKOFF DAY (PAID_TIER_CUTOVER): paid tags are assigned per
 * kickoff day, so a row kicking off before it was curated under the old rules.
 *   FAIL  kickoff on or after the cutover and breaking any rule above.
 *   warn  kickoff before it — historical, reported, never rewritten.
 *
 * READ-ONLY. Runs in preflight:db on a read-only Postgres session.
 *
 * Run: npx tsx --env-file=.env scripts/check-paid-tier-invariant.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

import { PAID_TIER_CUTOVER, classifyPaidTierDrift, type PaidTierDriftRow } from "../src/lib/geniusCuration";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  try {
    const raw = await prisma.prediction.findMany({
      where: { status: { not: "ARCHIVED" }, categories: { some: { category: { in: ["VIP", "PREMIUM"] } } } },
      select: {
        id: true, status: true, marketType: true, confidence: true, kickoff: true, fixtureApiId: true,
        homeTeamApiId: true, awayTeamApiId: true, categories: { select: { category: true } },
      },
    });
    const rows: PaidTierDriftRow[] = raw.map((r) => ({ ...r, categories: r.categories.map((c) => c.category) }));
    const drift = classifyPaidTierDrift(rows);

    const tally = (list: typeof drift.legacy) =>
      list.reduce<Record<string, number>>((acc, { issues }) => {
        for (const i of issues) acc[i] = (acc[i] ?? 0) + 1;
        return acc;
      }, {});

    console.log(`live VIP/PREMIUM rows: ${rows.length} (cutover ${PAID_TIER_CUTOVER.toISOString()}, by kickoff)`);
    console.log(`  clean:                                   ${drift.clean}`);
    console.log(`  warn  historical (pre-cutover kickoff):  ${drift.legacy.length}  ${JSON.stringify(tally(drift.legacy))}`);
    console.log(`  FAIL  post-cutover violations:           ${drift.violations.length}  ${JSON.stringify(tally(drift.violations))}`);
    for (const { row, issues } of drift.violations) {
      console.error(`    ${row.id}  kickoff ${row.kickoff?.toISOString()}  ${row.marketType} ${row.confidence}  [${row.categories.join(", ")}]  ${issues.join(", ")}`);
    }

    if (drift.violations.length) {
      console.error(`\nFAIL: ${drift.violations.length} VIP/PREMIUM row(s) kicking off after the cutover break the paid-tier invariant`);
      process.exit(1);
    }
    console.log("\nPASS: every VIP/PREMIUM row kicking off after the cutover meets its floor, is a single, and is its fixture's only paid pick");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
