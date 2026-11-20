/**
 * Where did the Bet of the Day price come from?
 *
 * Prints the current Bet of the Day pick, the cached quotes behind its price
 * (best, median, and the top bookmaker quotes), and how often a selection's
 * best price sits far above the median across every cached fixture, which is
 * the signature of one bookmaker out of line with the market.
 *
 * READ-ONLY. No provider calls, no writes.
 * Run: npx tsx scripts/inspect-botd-odds.ts
 */
export {};
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { toBookmakerSelection, findSelection, type FixtureOdds } from "../src/lib/odds";
import { matchKey } from "../src/lib/slug";

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
    console.log("session verified read-only");
  }

  const rows = await prisma.prediction.findMany({
    where: { categories: { some: { category: "BET_OF_THE_DAY" } }, kickoff: { gte: new Date(Date.now() - 36 * 3_600_000) } },
    select: { id: true, homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, marketType: true, selection: true, market: true, pick: true, confidence: true, fixtureApiId: true, betOfDayPinnedAt: true, outcome: true },
  });
  console.log(`\nBet of the Day rows near now: ${rows.length}`);
  for (const r of rows) {
    console.log(`\n${r.homeTeam} v ${r.awayTeam}  kickoff ${r.kickoff?.toISOString()}  ${r.market} / ${r.pick}  conf ${r.confidence}  pinned ${r.betOfDayPinnedAt?.toISOString() ?? "no"}  outcome ${r.outcome}`);
    console.log(`  marketType ${r.marketType}  selection ${JSON.stringify(r.selection)}`);
    const mapped = toBookmakerSelection(r.marketType, r.selection);
    console.log(`  feed lookup: ${JSON.stringify(mapped)}`);
    const key = matchKey({ homeTeamApiId: r.homeTeamApiId, awayTeamApiId: r.awayTeamApiId, kickoff: r.kickoff });
    const cache = key ? await prisma.fixtureOddsCache.findUnique({ where: { matchKey: key } }) : null;
    console.log(`  cache row: ${cache ? `fetchedAt ${cache.fetchedAt?.toISOString()} books ${cache.bookmakerCount} fixtureApiId ${cache.fixtureApiId}` : "none"}`);
    const odds = cache?.oddsJson as unknown as FixtureOdds | null;
    if (!odds) continue;
    if (mapped) {
      const sel = findSelection(odds, mapped.market, mapped.value);
      console.log(`  gate selection: ${JSON.stringify(sel)}`);
    }
    for (const m of odds.markets) {
      if (m.market !== (mapped?.market ?? "Both Teams Score")) continue;
      console.log(`  market "${m.market}":`);
      for (const s of m.selections) console.log(`    ${s.value.padEnd(10)} best ${s.best}  median ${s.median}  books ${s.bookmakers}  top: ${(s.quotes ?? []).map((q) => `${q.bookmaker} ${q.odd}`).join(", ")}`);
    }
  }

  // How often is the best price an outlier against the median, across the whole cache?
  const all = await prisma.fixtureOddsCache.findMany({ where: { oddsJson: { not: null as any }, fetchedAt: { gte: new Date(Date.now() - 48 * 3_600_000) } }, select: { oddsJson: true } });
  const stats: Record<string, { n: number; over125: number; over150: number; over200: number }> = {};
  for (const c of all) {
    const o = c.oddsJson as unknown as FixtureOdds;
    for (const m of o.markets) for (const s of m.selections) {
      if (s.median <= 0) continue;
      const k = (stats[m.market] ??= { n: 0, over125: 0, over150: 0, over200: 0 });
      const ratio = s.best / s.median;
      k.n++;
      if (ratio > 1.25) k.over125++;
      if (ratio > 1.5) k.over150++;
      if (ratio > 2) k.over200++;
    }
  }
  console.log(`\nBest price vs median across ${all.length} cached fixtures (fetched in the last 48h), by market:`);
  for (const [m, k] of Object.entries(stats)) console.log(`  ${m.padEnd(18)} selections ${k.n}  best>1.25x median ${k.over125}  >1.5x ${k.over150}  >2x ${k.over200}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
