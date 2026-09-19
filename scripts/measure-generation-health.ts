/**
 * Generation health, in one page of numbers.
 *
 * The eight figures below are the ones that distinguish "the pipeline is quiet
 * because the market is quiet" from "the pipeline is starving and returning
 * 200s". Every one of them was needed to diagnose a real outage in which
 * FEATURED kept producing 200+ live picks while VIP, PREMIUM and Bet of the Day
 * produced 3, 1 and 0 — which looked, from the outside, like a working system.
 *
 * READ-ONLY. It fetches nothing from api-football, generates nothing, and
 * writes nothing. Safe to run against production at any time.
 *
 * Run: npx tsx --env-file=.env scripts/measure-generation-health.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { matchKey } from "../src/lib/slug";
import { qualifiesForBetOfDay, type FixtureOdds } from "../src/lib/odds";
import { VIP_PROXY_LEAGUE_IDS } from "../src/lib/ai/generationRisk";
import { MC_MAX_QUOTE_AGE_MS } from "../src/lib/marketConfirmed";

const H72 = 72 * 60 * 60 * 1000;
const pad = (n: unknown, w = 5) => String(n).padStart(w);

async function main() {
  const now = new Date();
  const horizon = new Date(now.getTime() + H72);

  // ---- The fixture universe. The Fixture table is unused in production (0
  // rows); GenerationAttempt is the real ledger of known fixtures, and
  // published predictions cover anything already generated.
  const ledger = await prisma.generationAttempt.findMany({
    where: { kickoff: { gte: now, lte: horizon } },
    select: { matchKey: true, status: true, leagueApiId: true, kickoff: true },
  });
  const published = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: now, lt: horizon }, homeTeamApiId: { not: null }, awayTeamApiId: { not: null } },
    select: { homeTeamApiId: true, awayTeamApiId: true, kickoff: true, leagueApiId: true, marketType: true, selection: true, confidence: true },
  });

  const universe = new Map<string, { leagueApiId: number | null; kickoff: Date }>();
  for (const r of ledger) if (r.matchKey) universe.set(r.matchKey, { leagueApiId: r.leagueApiId, kickoff: r.kickoff! });
  for (const p of published) {
    const k = matchKey(p as never);
    if (k && p.kickoff) universe.set(k, { leagueApiId: p.leagueApiId, kickoff: p.kickoff });
  }

  const keys = [...universe.keys()];
  const cache = keys.length
    ? await prisma.fixtureOddsCache.findMany({
        where: { matchKey: { in: keys } },
        select: { matchKey: true, fetchedAt: true, bookmakerCount: true, oddsJson: true },
      })
    : [];
  const byKey = new Map(cache.map((c) => [c.matchKey, c]));
  const priced = cache.filter((c) => c.fetchedAt != null);
  const fresh = priced.filter((c) => now.getTime() - c.fetchedAt!.getTime() <= MC_MAX_QUOTE_AGE_MS);

  const paidKeys = keys.filter((k) => (VIP_PROXY_LEAGUE_IDS as readonly number[]).includes(universe.get(k)!.leagueApiId ?? -1));
  const claimable = ledger.filter((r) => r.status === "PENDING");
  const paidClaimable = claimable.filter((r) => (VIP_PROXY_LEAGUE_IDS as readonly number[]).includes(r.leagueApiId ?? -1));

  console.log("=== Generation health ===");
  console.log(`  as of ${now.toISOString()}   (horizon: next 72h)\n`);

  console.log("-- Fixture universe & odds coverage --");
  console.log(`  upcoming fixtures, next 72h:            ${pad(universe.size)}`);
  console.log(`  ...in the 12 paid-tier leagues:         ${pad(paidKeys.length)}`);
  console.log(`  ...with ANY odds row:                   ${pad(priced.length)}`);
  console.log(`  ...with FRESH odds (<= ${(MC_MAX_QUOTE_AGE_MS / 3600000).toFixed(0)}h):            ${pad(fresh.length)}`);
  console.log(`  ...with no odds at all:                 ${pad(universe.size - priced.length)}`);
  if (priced.length) {
    const ages = priced.map((c) => (now.getTime() - c.fetchedAt!.getTime()) / 3600000).sort((a, b) => a - b);
    console.log(`  quote age h: min=${ages[0].toFixed(1)} median=${ages[Math.floor(ages.length / 2)].toFixed(1)} max=${ages[ages.length - 1].toFixed(1)}`);
  }

  console.log("\n-- VIP / PREMIUM --");
  console.log(`  ledger rows in horizon:                 ${pad(ledger.length)}`);
  console.log(`  ...still PENDING (claimable by anyone): ${pad(claimable.length)}`);
  console.log(`  ...PENDING and paid-tier league:        ${pad(paidClaimable.length)}   <- what the paid pass can take`);
  const vipLive = await prisma.prediction.count({ where: { categories: { some: { category: "VIP" } }, status: "PUBLISHED", kickoff: { gt: now } } });
  const premLive = await prisma.prediction.count({ where: { categories: { some: { category: "PREMIUM" } }, status: "PUBLISHED", kickoff: { gt: now } } });
  console.log(`  live VIP picks:                         ${pad(vipLive)}`);
  console.log(`  live PREMIUM picks:                     ${pad(premLive)}`);

  console.log("\n-- Bet of the Day --");
  const oddsFor = (p: (typeof published)[number]) => {
    const k = matchKey(p as never);
    const row = k ? byKey.get(k) : undefined;
    return ((row?.oddsJson as unknown as FixtureOdds | null) ?? null) as FixtureOdds | null;
  };
  let eligible = 0;
  const reasons: Record<string, number> = {};
  for (const p of published) {
    const gate = qualifiesForBetOfDay({ odds: oddsFor(p), marketType: p.marketType, selection: p.selection as never, confidence: p.confidence });
    if (gate.qualifies) eligible++;
    else for (const r of gate.reasons) {
      const norm = r.replace(/-?\d+(\.\d+)?/g, "N");
      reasons[norm] = (reasons[norm] ?? 0) + 1;
    }
  }
  console.log(`  published picks evaluated:              ${pad(published.length)}`);
  console.log(`  ELIGIBLE candidates:                    ${pad(eligible)}`);
  const botdLive = await prisma.prediction.count({ where: { categories: { some: { category: "BET_OF_THE_DAY" } } } });
  console.log(`  BET_OF_THE_DAY rows ever:               ${pad(botdLive)}`);
  console.log("  rejection reasons:");
  for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`    ${pad(n, 4)}  ${r}`);

  // The odds warming queue, WITHOUT fetching anything. This is what the cron
  // would work through on its next tick, so it shows whether the scope reaches
  // the far end of the horizon — the thing that was broken.
  console.log("\n-- Odds warming queue (dry; no api-football calls) --");
  const { getScopedOddsTargets, selectStaleOddsTargets } = await import("../src/lib/enrichment");
  const scoped = await getScopedOddsTargets(now);
  const due = await selectStaleOddsTargets(scoped, now);
  console.log(`  scoped targets:                         ${pad(scoped.length)}`);
  console.log(`  ...due on this tick:                    ${pad(due.length)}`);
  const distance = (t: { kickoff: Date }) => {
    const h = (t.kickoff.getTime() - now.getTime()) / 3600000;
    return h < 24 ? "0-24h" : h < 48 ? "24-48h" : "48-72h";
  };
  const buckets: Record<string, number> = { "0-24h": 0, "24-48h": 0, "48-72h": 0 };
  for (const t of due) buckets[distance(t)]++;
  console.log(`  due by kickoff distance:                0-24h=${buckets["0-24h"]}  24-48h=${buckets["24-48h"]}  48-72h=${buckets["48-72h"]}`);
  console.log("  first 5 in queue order:");
  for (const t of due.slice(0, 5)) console.log(`    ${distance(t).padEnd(7)} ${t.kind.padEnd(10)} ${t.matchKey}`);

  console.log("\n-- Scheduled job history (from JobRun) --");
  const jobs = await prisma.jobRun.groupBy({ by: ["job"], _count: true, _max: { ranAt: true } });
  if (!jobs.length) console.log("  (no JobRun records at all)");
  for (const j of jobs.sort((a, b) => a.job.localeCompare(b.job))) {
    const age = j._max.ranAt ? ((now.getTime() - j._max.ranAt.getTime()) / 3600000).toFixed(1) + "h ago" : "never";
    console.log(`  ${j.job.padEnd(26)} runs=${pad(j._count, 4)}  last: ${age}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("measure-generation-health failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
