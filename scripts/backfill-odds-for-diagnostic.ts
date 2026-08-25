/**
 * Backfills FixtureOddsCache for fixtures behind recent generated predictions,
 * so the market-calibration diagnostic has a sample worth drawing a conclusion
 * from.
 *
 * The normal odds workload is scoped to today's published picks and upcoming
 * generation candidates — correct for production, but it leaves only ~40 of
 * ~180 recent predictions with a price, and the extreme-lopsidedness band held
 * a single fixture. A verdict off n=1 is not a verdict.
 *
 * api-football serves odds for already-played fixtures (verified in
 * scripts/research-odds-leadtime.ts, which found full books on fixtures up to a
 * week old), so the history can be filled in.
 *
 * Cost control: fixture ids are resolved a DAY at a time — one /fixtures?date=
 * call covers that whole day's slate — then one /odds call per fixture. Same
 * approach refreshFixtureDetailsForDay already uses.
 *
 * Writes only to FixtureOddsCache, which is a cache. Generates nothing.
 *
 * Run: npx tsx --env-file=.env scripts/backfill-odds-for-diagnostic.ts [days] [maxFixtures]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { matchKey, kickoffDay } from "../src/lib/slug";
import { getFixturesByDate, getOdds } from "../src/lib/football/api-football";
import { trimOdds } from "../src/lib/odds";
import { getUsageSnapshot } from "../src/lib/football/usage";

async function main() {
  const days = Number(process.argv[2]) || 14;
  const maxFixtures = Number(process.argv[3]) || 160;
  const since = new Date(Date.now() - days * 86_400_000);
  const before = await getUsageSnapshot();

  const preds = await prisma.prediction.findMany({
    where: { createdAt: { gte: since }, homeTeamApiId: { not: null }, awayTeamApiId: { not: null }, kickoff: { not: null } },
    select: { homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
  });

  // Distinct fixtures, minus those already priced.
  const wanted = new Map<string, { home: number; away: number; day: string }>();
  for (const p of preds) {
    const key = matchKey(p);
    if (key && !wanted.has(key)) wanted.set(key, { home: p.homeTeamApiId!, away: p.awayTeamApiId!, day: kickoffDay(p.kickoff!) });
  }
  const existing = await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: [...wanted.keys()] }, fetchedAt: { not: null } },
    select: { matchKey: true },
  });
  for (const e of existing) wanted.delete(e.matchKey);

  console.log(`distinct fixtures behind recent predictions: ${wanted.size + existing.length}`);
  console.log(`already priced: ${existing.length} | to backfill: ${Math.min(wanted.size, maxFixtures)}`);

  // Group by day so fixture-id resolution costs one call per day, not per fixture.
  const byDay = new Map<string, Array<{ key: string; home: number; away: number }>>();
  for (const [key, v] of wanted) {
    if (!byDay.has(v.day)) byDay.set(v.day, []);
    byDay.get(v.day)!.push({ key, home: v.home, away: v.away });
  }

  let resolved = 0;
  let priced = 0;
  let noOdds = 0;
  let unresolved = 0;
  let processed = 0;

  for (const [day, targets] of [...byDay.entries()].sort()) {
    if (processed >= maxFixtures) break;
    const slate = await getFixturesByDate(day);
    if (!slate) {
      console.log(`  ${day}: no slate returned`);
      continue;
    }
    for (const t of targets) {
      if (processed >= maxFixtures) break;
      const found = slate.find((f) => f.teams.home.id === t.home && f.teams.away.id === t.away);
      if (!found) {
        unresolved++;
        continue;
      }
      resolved++;
      processed++;
      const now = new Date();
      const raw = await getOdds(found.fixture.id);
      const trimmed = trimOdds(raw?.[0]);
      if (!trimmed) {
        noOdds++;
        await prisma.fixtureOddsCache
          .upsert({
            where: { matchKey: t.key },
            create: { matchKey: t.key, fixtureApiId: found.fixture.id, lastAttemptAt: now, lastError: "No bookmaker prices returned" },
            update: { fixtureApiId: found.fixture.id, lastAttemptAt: now, lastError: "No bookmaker prices returned" },
          })
          .catch(() => {});
        continue;
      }
      priced++;
      const payload = {
        matchKey: t.key,
        fixtureApiId: found.fixture.id,
        oddsJson: trimmed as any,
        bookmakerCount: trimmed.bookmakerCount,
        fetchedAt: now,
        lastAttemptAt: now,
        lastError: null,
      };
      await prisma.fixtureOddsCache.upsert({ where: { matchKey: t.key }, create: payload, update: payload });
    }
    console.log(`  ${day}: ${targets.length} targets, running totals — resolved ${resolved}, priced ${priced}, no odds ${noOdds}, unresolved ${unresolved}`);
  }

  const after = await getUsageSnapshot();
  console.log(`\nbackfilled: ${priced} priced, ${noOdds} had no odds, ${unresolved} not found in their day's slate`);
  console.log(`api-football calls spent: ${after.used - before.used} (remaining today ${after.remaining})`);
  await prisma.$disconnect();
}

main();
