/**
 * Manually run the odds enrichment workload — the same code path the cron
 * calls, so what it reports is what production does.
 *
 * Runs `fixture-details` first: the odds workload deliberately does NOT
 * resolve api-football fixture ids itself, it reads the ones FixtureDetailCache
 * already holds (see getScopedOddsTargets). A fixture the detail refresh has
 * never reached is therefore skipped rather than costing a second lookup, which
 * on a cold cache means an odds run finds nothing until details have landed.
 *
 * Run: npx tsx --env-file=.env scripts/run-odds-refresh.ts [limit]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";

async function main() {
  const limit = Math.min(50, Math.max(1, Number(process.argv[2]) || 30));
  const { runEnrichmentWorkload } = await import("../src/lib/enrichmentWorkloads");

  const details = await runEnrichmentWorkload("fixture-details", { limit: 10 });
  console.log("fixture-details:", JSON.stringify({ scoped: details.scoped, processed: details.processed, ok: details.okCount, failed: details.failedCount }));

  const odds = await runEnrichmentWorkload("odds", { limit });
  console.log(
    "odds:",
    JSON.stringify({ scoped: odds.scoped, eligible: odds.eligible, processed: odds.processed, ok: odds.okCount, failed: odds.failedCount, budgetExhausted: odds.budgetExhausted }),
  );
  for (const r of odds.results.slice(0, 15)) console.log(`  ${r.result.padEnd(7)} ${r.id} ${r.detail ?? ""}`);

  const cached = await prisma.fixtureOddsCache.count({ where: { fetchedAt: { not: null } } });
  console.log(`FixtureOddsCache rows with prices: ${cached}`);
  await prisma.$disconnect();
}

main();
