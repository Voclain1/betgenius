/**
 * Why does the dedicated Market-Confirmed pass promote 3 picks out of 82
 * attempts, when a retro-replay of the same gate over the same population
 * confirms 23.9%?
 *
 * The replay neutralised quote staleness; production does not. So this asks the
 * production question directly: at the moment each Market-Confirmed draft was
 * created, was there a cached bookmaker quote for that fixture at all, and was
 * it inside MC_MAX_QUOTE_AGE_MS?
 *
 * The answer decides the whole proposal. If the gate is rejecting real
 * disagreement, a second pass on the same pattern is sound. If it is starving
 * on cold odds, a second pass would reproduce the same near-zero yield and the
 * odds-freshness step is the thing that has to be built first.
 *
 * Read-only. Run: npx tsx --env-file=.env scripts/research-vip-premium-gatefail.ts [days]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { matchKey } from "../src/lib/slug";
import { evaluateMarketConfirmed, MC_MAX_QUOTE_AGE_MS } from "../src/lib/marketConfirmed";
import type { FixtureOdds } from "../src/lib/odds";
import type { Selection } from "../src/lib/markets";

const DAYS = Number(process.argv[2] ?? 90);
const pct = (n: number, d: number) => (d === 0 ? "  n/a" : `${((n / d) * 100).toFixed(1)}%`);

function intentOf(promptJson: string): string | null {
  try {
    return JSON.parse(promptJson)?.intent ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86_400_000);

  const rows = await prisma.prediction.findMany({
    where: { createdAt: { gte: since }, aiJobId: { not: null } },
    select: {
      id: true, createdAt: true, confidence: true, marketType: true, selection: true,
      provenance: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, outcome: true,
      aiJob: { select: { prompt: true } },
    },
  });
  const mine = rows.filter((r) => r.aiJob && intentOf(r.aiJob.prompt) === "MARKET_CONFIRMED");
  console.log(`\n=== Market-Confirmed drafts, last ${DAYS} days: n=${mine.length} ===\n`);

  const keys = [...new Set(mine.map((r) => matchKey(r)).filter((k): k is string => k !== null))];
  const cached = await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: keys } },
    select: { matchKey: true, oddsJson: true, fetchedAt: true, lastAttemptAt: true, lastError: true },
  });
  const byKey = new Map(cached.map((c) => [c.matchKey, c]));

  console.log(`--- Odds availability AT DRAFT TIME ---`);
  let noCacheRow = 0, cacheRowNoOdds = 0, oddsButStale = 0, oddsFresh = 0;
  const staleAgesH: number[] = [];
  for (const r of mine) {
    const c = byKey.get(matchKey(r) ?? "");
    if (!c) { noCacheRow++; continue; }
    if (!c.oddsJson || !c.fetchedAt) { cacheRowNoOdds++; continue; }
    // fetchedAt is the CURRENT cache state, refreshed since. The honest
    // production question is whether the quote the gate saw was fresh THEN,
    // which is only answerable where the cache has not been rewritten since —
    // so this reports the age as of the draft, negative where the cache row is
    // newer than the draft (i.e. it was filled afterwards, too late to help).
    const ageMs = r.createdAt.getTime() - c.fetchedAt.getTime();
    if (ageMs < 0 || ageMs > MC_MAX_QUOTE_AGE_MS) {
      oddsButStale++;
      staleAgesH.push(ageMs / 3_600_000);
    } else {
      oddsFresh++;
    }
  }
  console.log(`  no FixtureOddsCache row at all:        ${String(noCacheRow).padStart(4)}  ${pct(noCacheRow, mine.length)}`);
  console.log(`  cache row but never priced:            ${String(cacheRowNoOdds).padStart(4)}  ${pct(cacheRowNoOdds, mine.length)}`);
  console.log(`  priced, but not within ${MC_MAX_QUOTE_AGE_MS / 3_600_000}h of the draft: ${String(oddsButStale).padStart(4)}  ${pct(oddsButStale, mine.length)}`);
  console.log(`  priced and fresh at draft time:        ${String(oddsFresh).padStart(4)}  ${pct(oddsFresh, mine.length)}`);
  if (staleAgesH.length) {
    staleAgesH.sort((a, b) => a - b);
    console.log(`     quote-age at draft, hours (negative = cache filled AFTER the draft):`);
    console.log(`     min ${staleAgesH[0].toFixed(1)}  median ${staleAgesH[Math.floor(staleAgesH.length / 2)].toFixed(1)}  max ${staleAgesH[staleAgesH.length - 1].toFixed(1)}`);
  }

  console.log(`\n--- Gate verdict IGNORING staleness (the picks the market would have confirmed) ---`);
  const tally = new Map<string, number>();
  for (const r of mine) {
    const c = byKey.get(matchKey(r) ?? "");
    const asOf = c?.fetchedAt ?? new Date();
    const v = evaluateMarketConfirmed({
      marketType: r.marketType,
      selection: r.selection as Selection,
      confidence: r.confidence,
      odds: (c?.oddsJson as unknown as FixtureOdds | null) ?? null,
      fetchedAt: asOf,
      now: asOf,
    });
    const k = v.confirmed ? "CONFIRMED" : (v.reason ?? "?");
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${String(n).padStart(4)}  ${pct(n, mine.length)}`);
  }
  const promoted = mine.filter((r) => r.provenance === "MARKET_CONFIRMED").length;
  console.log(`\n  actually promoted in production: ${promoted}  ${pct(promoted, mine.length)}`);
  console.log(`  confirmed on a fresh-quote replay: ${tally.get("CONFIRMED") ?? 0}  ${pct(tally.get("CONFIRMED") ?? 0, mine.length)}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
