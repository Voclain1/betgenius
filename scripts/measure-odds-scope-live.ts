/**
 * Exercises the widened odds scope and price-first targeting against REAL
 * candidates, and measures what the widening actually costs in api-football
 * calls.
 *
 * Why this is not just a re-run of measure-odds-scope.ts: the generation ledger
 * is normally drained — every fixture inside the 2-48h generation window has
 * already been generated, so it sits at SUCCEEDED and the PENDING candidate set
 * is empty. Measuring that state reports zero and proves nothing, and the
 * verification checks pass vacuously.
 *
 * So this temporarily returns a set of real future-kickoff ledger rows to
 * PENDING — the exact state they occupy between discovery and generation —
 * prices them for real, runs the real targeting, and then restores every row to
 * its original status. No predictions are generated.
 *
 * Run: npx tsx --env-file=.env scripts/measure-odds-scope-live.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { getUsageSnapshot } from "../src/lib/football/usage";
import { leaguePriorityRank } from "../src/lib/leagues";

async function main() {
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + 72 * 60 * 60 * 1000);

  const { runEnrichmentWorkload } = await import("../src/lib/enrichmentWorkloads");
  const { getCandidateOddsTargets } = await import("../src/lib/enrichment");
  const { selectBetOfTheDayTargets } = await import("../src/lib/betOfTheDay");

  // Real ledger rows for fixtures still ahead of us, inside the odds horizon.
  const rows = await prisma.generationAttempt.findMany({
    where: { kickoff: { gt: now, lte: horizonEnd }, fixtureApiId: { not: null }, leagueApiId: { not: null } },
    select: { id: true, matchKey: true, status: true, leagueApiId: true, kickoff: true, homeTeam: true, awayTeam: true },
  });
  const ranked = rows.filter((r) => leaguePriorityRank(r.leagueApiId) < 999);
  console.log(`ledger rows with kickoff inside 72h: ${rows.length} (${ranked.length} in ranked leagues)`);
  if (ranked.length === 0) {
    console.log("nothing to measure");
    await prisma.$disconnect();
    return;
  }

  const original = new Map(ranked.map((r) => [r.id, r.status]));
  const before = await getUsageSnapshot();
  const cachedBefore = await prisma.fixtureOddsCache.count({ where: { fetchedAt: { not: null } } });

  try {
    await prisma.generationAttempt.updateMany({ where: { id: { in: ranked.map((r) => r.id) } }, data: { status: "PENDING" } });

    const candidates = await getCandidateOddsTargets();
    const newlyScoped = candidates.length;
    console.log(`\ncandidate odds targets now in scope: ${newlyScoped}`);

    // Price them for real — this IS the marginal cost of the widening.
    let cycles = 0;
    let priced = 0;
    while (cycles < 8) {
      const r = await runEnrichmentWorkload("odds", { limit: 50 });
      cycles++;
      priced += r.okCount;
      console.log(`  odds cycle ${cycles}: eligible=${r.eligible} processed=${r.processed} ok=${r.okCount} failed=${r.failedCount}`);
      if (r.eligible === 0 || r.processed === 0) break;
    }

    const after = await getUsageSnapshot();
    const cachedAfter = await prisma.fixtureOddsCache.count({ where: { fetchedAt: { not: null } } });

    // Second pass must be free: candidates are priced ONCE, never re-polled.
    const repeat = await runEnrichmentWorkload("odds", { limit: 50 });

    const { targets, considered, pricedInBand } = await selectBetOfTheDayTargets();

    console.log("\n--- MEASURED COST OF THE WIDENING ---");
    console.log(`api-football calls spent: ${after.used - before.used}`);
    console.log(`fixtures newly priced:    ${cachedAfter - cachedBefore}`);
    console.log(`candidates in scope:      ${newlyScoped}`);
    console.log(`re-poll on second pass:   ${repeat.eligible} eligible (candidates are priced once, so this should be 0)`);
    console.log(`daily quota:              ${after.limit} (reserve ${after.reserve}), used today ${after.used}`);

    console.log("\n--- PRICE-FIRST TARGETING ON REAL DATA ---");
    console.log(`considered=${considered}  pricedInBand=${pricedInBand}  selected=${targets.length}`);
    for (const t of targets) {
      console.log(`  ${t.homeTeam} v ${t.awayTeam} — ${t.market} ${t.selection} @ ${t.price} (${t.bookmakers} books, league rank ${leaguePriorityRank(t.leagueApiId)})`);
    }
    if (pricedInBand === 0) console.log("  (no candidate is priced into the 2.20-4.50 band right now)");
  } finally {
    // Restore every row to the status it had, whatever happened above.
    for (const [id, status] of original) {
      await prisma.generationAttempt.update({ where: { id }, data: { status } }).catch(() => {});
    }
    const restored = await prisma.generationAttempt.count({ where: { id: { in: ranked.map((r) => r.id) }, status: "PENDING" } });
    console.log(`\nledger restored — rows still PENDING: ${restored} (expected ${[...original.values()].filter((s) => s === "PENDING").length})`);
  }

  await prisma.$disconnect();
}

main();
