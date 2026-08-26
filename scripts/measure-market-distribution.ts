/**
 * Read-only production measurement of generated market selection.
 *
 * Uses the same independent market-favourite probability bands as
 * compare-market-calibration.ts. No model or football API calls are made.
 *
 * Run: npx tsx scripts/measure-market-distribution.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { matchKey } from "../src/lib/slug";
import { findSelection, impliedProbability, type FixtureOdds } from "../src/lib/odds";

type Row = {
  id: string;
  aiJobId: string | null;
  createdAt: Date;
  marketType: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  kickoff: Date | null;
  aiJob: { prompt: string } | null;
};

const BANDS = [
  { key: "EXTREME", lo: 75, hi: 101 },
  { key: "STRONG", lo: 65, hi: 75 },
  { key: "MODERATE", lo: 48, hi: 60 },
  { key: "CLOSE", lo: 0, hi: 45 },
] as const;

function favouriteProbability(odds: FixtureOdds | null): number | null {
  if (!odds) return null;
  const prices = ["Home", "Draw", "Away"]
    .map((value) => findSelection(odds, "Match Winner", value)?.best)
    .filter((price): price is number => price != null);
  if (prices.length < 3) return null;
  const raw = prices.map(impliedProbability);
  return Math.max(...raw) / (raw.reduce((sum, value) => sum + value, 0) / 100);
}

function categories(row: Row): string[] {
  try {
    const parsed = JSON.parse(row.aiJob?.prompt ?? "{}");
    return Array.isArray(parsed.categories) ? parsed.categories : [];
  } catch {
    return [];
  }
}

function marketCounts(rows: Row[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.marketType] = (counts[row.marketType] ?? 0) + 1;
    return counts;
  }, {});
}

function printMix(label: string, rows: Row[]) {
  console.log(`\n${label}: ${rows.length}`);
  for (const [market, count] of Object.entries(marketCounts(rows)).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${market.padEnd(18)} ${String(count).padStart(4)}  ${(count / Math.max(rows.length, 1) * 100).toFixed(1)}%`);
  }
}

async function main() {
  const now = new Date();
  const since14 = new Date(now.getTime() - 14 * 86_400_000);
  const since7 = new Date(now.getTime() - 7 * 86_400_000);
  const rows = await prisma.prediction.findMany({
    where: { aiJobId: { not: null }, createdAt: { gte: since14 } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, aiJobId: true, createdAt: true, marketType: true,
      homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true,
      aiJob: { select: { prompt: true } },
    },
  });

  const standard = rows.filter((row) => !categories(row).includes("SAME_GAME_DOUBLE"));
  printMix("all AI generations, 14d", rows);
  printMix("all AI generations, 7d", rows.filter((row) => row.createdAt >= since7));
  printMix("standard single-market generations, 14d", standard);

  const keys = [...new Set(rows.map((row) => matchKey(row)).filter((key): key is string => !!key))];
  const caches = await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: keys }, fetchedAt: { not: null } },
    select: { matchKey: true, oddsJson: true, fetchedAt: true },
  });
  const oddsByKey = new Map(caches.map((cache) => [cache.matchKey, cache.oddsJson as unknown as FixtureOdds | null]));
  const priced = standard
    .map((row) => {
      const key = matchKey(row);
      const favourite = key ? favouriteProbability(oddsByKey.get(key) ?? null) : null;
      return favourite == null ? null : { row, favourite };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  console.log(`\npriced standard rows: ${priced.length}/${standard.length}`);
  for (const band of BANDS) {
    const inBand = priced.filter(({ favourite }) => favourite >= band.lo && favourite < band.hi).map(({ row }) => row);
    printMix(`${band.key} [${band.lo}-${band.hi === 101 ? "100" : band.hi}% favourite]`, inBand);
  }

  const moderate = priced.filter(({ favourite }) => favourite >= 48 && favourite < 60);
  const hedgeTypes = ["DOUBLE_CHANCE", "DRAW_NO_BET", "WIN_EITHER_HALF"];
  const hedgeCounts = marketCounts(moderate.map(({ row }) => row));
  console.log(`\nMODERATE hedge alternatives: ${hedgeTypes.map((type) => `${type}=${hedgeCounts[type] ?? 0}`).join("  ")}`);
  console.log(`oldest=${rows[0]?.createdAt.toISOString() ?? "-"} newest=${rows.at(-1)?.createdAt.toISOString() ?? "-"}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
