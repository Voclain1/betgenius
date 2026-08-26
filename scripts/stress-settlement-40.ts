/**
 * Production-safe 40-item settlement stress test.
 *
 * Clones one already-settled prediction into temporary, past-kickoff rows,
 * exercises the same lookup -> resolve -> persist sequence as the settlement
 * route, and deletes every row after each sample. Real predictions are read
 * only. Run count defaults to five.
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { lookupFinishedScore } from "../src/lib/settlement";
import { resolveMarket, type MarketType, type Selection } from "../src/lib/markets";
import { getUsageSnapshot } from "../src/lib/football/usage";

const MARKER = "__SETTLEMENT_STRESS_40__";

async function createRows(run: number, rowCount: number) {
  const source = await prisma.prediction.findFirst({
    where: {
      status: "PUBLISHED",
      outcome: { in: ["WON", "LOST", "VOID"] },
      settledAt: { not: null },
      manualSettlementOnly: false,
      marketType: { notIn: ["SAME_GAME_DOUBLE", "OTHER"] },
      selection: { not: Prisma.DbNull },
      kickoff: { not: null },
      homeTeam: { not: null },
      awayTeam: { not: null },
    },
    orderBy: { settledAt: "desc" },
  });
  if (!source?.kickoff || !source.homeTeam || !source.awayTeam) {
    throw new Error("No already-settled prediction is available as a safe fixture template");
  }

  const ids: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const row = await prisma.prediction.create({
      data: {
        fixtureId: source.fixtureId,
        category: "FEATURED",
        leagueApiId: source.leagueApiId,
        leagueName: source.leagueName,
        homeTeam: source.homeTeam,
        awayTeam: source.awayTeam,
        homeTeamApiId: source.homeTeamApiId,
        awayTeamApiId: source.awayTeamApiId,
        kickoff: source.kickoff,
        status: "PUBLISHED",
        outcome: "PENDING",
        marketType: source.marketType,
        selection: source.selection ?? undefined,
        manualSettlementOnly: false,
        market: source.market,
        pick: source.pick,
        confidence: source.confidence,
        reasoning: `${MARKER} run=${run} row=${i}`,
        contextComplete: true,
        authorId: source.authorId,
      },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return { ids, fixture: `${source.homeTeam} v ${source.awayTeam}`, kickoff: source.kickoff };
}

async function settleOnly(ids: string[]) {
  const candidates = await prisma.prediction.findMany({
    where: { id: { in: ids }, status: "PUBLISHED", outcome: "PENDING", manualSettlementOnly: false },
    orderBy: { id: "asc" },
  });
  let settled = 0;
  for (const prediction of candidates) {
    const lookup = await lookupFinishedScore({
      homeTeam: prediction.homeTeam!,
      awayTeam: prediction.awayTeam!,
      kickoff: prediction.kickoff!,
    });
    if (lookup.status !== "scored") throw new Error(`Fixture lookup returned ${lookup.status}`);
    const outcome = resolveMarket(
      prediction.marketType as MarketType,
      prediction.selection as Selection,
      lookup.homeScore,
      lookup.awayScore,
      lookup.halftime,
    );
    if (!outcome) throw new Error(`Market ${prediction.marketType} could not be resolved`);
    await prisma.prediction.update({
      where: { id: prediction.id },
      data: {
        finalHomeScore: lookup.homeScore,
        finalAwayScore: lookup.awayScore,
        outcome,
        settledAt: new Date(),
        settlementNote: null,
      },
    });
    settled++;
  }
  return settled;
}

async function main() {
  const runs = Math.max(3, Number(process.argv[2]) || 5);
  const rowCount = Math.max(1, Number(process.argv[3]) || 40);
  const samples: number[] = [];
  for (let run = 1; run <= runs; run++) {
    let ids: string[] = [];
    try {
      const prepared = await createRows(run, rowCount);
      ids = prepared.ids;
      const usageBefore = await getUsageSnapshot();
      const started = performance.now();
      const settled = await settleOnly(ids);
      const elapsedMs = performance.now() - started;
      const usageAfter = await getUsageSnapshot();
      const persisted = await prisma.prediction.count({
        where: { id: { in: ids }, outcome: { in: ["WON", "LOST", "VOID"] }, settledAt: { not: null } },
      });
      if (settled !== rowCount || persisted !== rowCount) throw new Error(`settled=${settled}, persisted=${persisted}`);
      samples.push(elapsedMs);
      console.log(`run ${run}: ${(elapsedMs / 1000).toFixed(2)}s total, ${(elapsedMs / rowCount).toFixed(0)}ms/item, api calls ${usageAfter.used - usageBefore.used}, ${prepared.fixture} (${prepared.kickoff.toISOString()})`);
    } finally {
      if (ids.length) await prisma.prediction.deleteMany({ where: { id: { in: ids } } });
      const remaining = await prisma.prediction.count({ where: { reasoning: { startsWith: MARKER } } });
      console.log(`  cleanup: ${remaining} temporary row(s) remain`);
      if (remaining !== 0) throw new Error(`${remaining} temporary settlement rows remain after cleanup`);
    }
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  console.log(`\n${rowCount}-item runtime: min ${(sorted[0] / 1000).toFixed(2)}s, mean ${(mean / 1000).toFixed(2)}s, max ${(sorted.at(-1)! / 1000).toFixed(2)}s, n=${samples.length}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.prediction.deleteMany({ where: { reasoning: { startsWith: MARKER } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
