/**
 * Second half of the VIP/PREMIUM dedicated-pass research.
 *
 *   A. WHY the odds cross-check fails when it fails, broken down by market type
 *      — the number that decides whether a dedicated pass should steer which
 *      market it asks for, or just accept whatever the model picks.
 *   B. What one dedicated generation attempt actually costs: api-football calls
 *      token spend per job, and metered api-football spend per day, against
 *      the 7,500/day provider budget.
 *   C. Whether PREMIUM's 80 confidence floor separates it from VIP at all, in
 *      settled outcomes, against the alternative of separating on the market.
 *
 * Read-only. Run: npx tsx --env-file=.env scripts/research-vip-premium-cost.ts [days]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { matchKey } from "../src/lib/slug";
import { evaluateMarketConfirmed, isEligibleMarketType } from "../src/lib/marketConfirmed";
import type { FixtureOdds } from "../src/lib/odds";
import type { Selection } from "../src/lib/markets";
import { VIP_PROXY_LEAGUE_IDS } from "../src/lib/ai/generationRisk";
import { VIP_ROUTE_PROVENANCE, VIP_CONFIDENCE_FLOOR, PREMIUM_CONFIDENCE_FLOOR } from "../src/lib/geniusCuration";

const DAYS = Number(process.argv[2] ?? 90);
const pct = (n: number, d: number) => (d === 0 ? "  n/a" : `${((n / d) * 100).toFixed(1)}%`);

async function main() {
  const since = new Date(Date.now() - DAYS * 86_400_000);
  console.log(`\n=== VIP/PREMIUM dedicated-pass: failure modes and cost — last ${DAYS} days ===\n`);

  const rows = await prisma.prediction.findMany({
    where: { kickoff: { gte: since } },
    select: {
      id: true, confidence: true, marketType: true, selection: true, provenance: true,
      leagueApiId: true, outcome: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true,
      categories: { select: { category: true } },
    },
  });

  const eligible = rows.filter(
    (r) =>
      (r.provenance === VIP_ROUTE_PROVENANCE || (VIP_PROXY_LEAGUE_IDS as readonly number[]).includes(r.leagueApiId ?? -1)) &&
      r.confidence >= VIP_CONFIDENCE_FLOOR &&
      r.marketType !== "SAME_GAME_DOUBLE",
  );
  const keys = [...new Set(eligible.map((r) => matchKey(r)).filter((k): k is string => k !== null))];
  const cached = await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: keys } },
    select: { matchKey: true, oddsJson: true, fetchedAt: true },
  });
  const byKey = new Map(cached.map((c) => [c.matchKey, c]));

  // ---- A. failure modes per market type ----------------------------------
  console.log(`--- A. Gate outcome by market type (eligible rows, n=${eligible.length}) ---`);
  const perType = new Map<string, Map<string, number>>();
  for (const r of eligible) {
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
    const key = v.confirmed ? "CONFIRMED" : (v.reason ?? "?");
    if (!perType.has(r.marketType)) perType.set(r.marketType, new Map());
    const m = perType.get(r.marketType)!;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  for (const [mt, m] of [...perType.entries()].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0))) {
    const total = [...m.values()].reduce((x, y) => x + y, 0);
    console.log(`  ${mt}${isEligibleMarketType(mt) ? "" : "  (not MC-eligible)"} — ${total} rows`);
    for (const [reason, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${reason.padEnd(20)} ${String(n).padStart(4)}  ${pct(n, total)}`);
    }
  }

  // Would the SAME fixtures have passed on a different market? The dedicated
  // pass can choose what to ask for, so this bounds what steering could buy.
  const fixturesWithOdds = keys.filter((k) => byKey.get(k)?.oddsJson);
  console.log(`\n  fixtures with real odds: ${fixturesWithOdds.length} of ${keys.length}`);
  let mwQuoted = 0, dcQuoted = 0;
  for (const k of fixturesWithOdds) {
    const odds = byKey.get(k)!.oddsJson as unknown as FixtureOdds;
    if (odds.markets?.some((m) => m.market === "Match Winner")) mwQuoted++;
    if (odds.markets?.some((m) => m.market === "Double Chance")) dcQuoted++;
  }
  console.log(`      quote a Match Winner line:  ${mwQuoted}  ${pct(mwQuoted, fixturesWithOdds.length)}`);
  console.log(`      quote a Double Chance line: ${dcQuoted}  ${pct(dcQuoted, fixturesWithOdds.length)}`);

  // ---- B. cost per attempt ----------------------------------------------
  //
  // AIJob.context holds the stored MatchDigest, not the ContextSources counter,
  // so per-job api-football spend is not recorded per row. The two figures that
  // ARE recorded are the model-side token cost per job and the metered
  // api-football spend per day, and together with the documented ~11-cold /
  // 0-warm context cost they bound what a quota of N attempts a day costs.
  console.log(`
--- B. Cost of one generation attempt (recorded, not estimated) ---`);
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: since } },
    select: { promptTokens: true, outputTokens: true, durationMs: true, model: true },
    orderBy: { createdAt: "desc" },
    take: 400,
  });
  const nums = (xs: Array<number | null>) => xs.filter((n): n is number => typeof n === "number").sort((a, b) => a - b);
  const stat = (label: string, xs: number[]) => {
    if (!xs.length) return console.log(`      ${label}: none recorded`);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log(`      ${label}: median ${xs[Math.floor(xs.length / 2)]}  mean ${mean.toFixed(0)}  p90 ${xs[Math.floor(xs.length * 0.9)]}  (n=${xs.length})`);
  };
  console.log(`  AIJobs sampled: ${jobs.length}`);
  stat("prompt tokens", nums(jobs.map((j) => j.promptTokens)));
  stat("output tokens", nums(jobs.map((j) => j.outputTokens)));
  stat("model call ms ", nums(jobs.map((j) => j.durationMs)));
  const models = new Map<string, number>();
  for (const j of jobs) models.set(j.model ?? "(null)", (models.get(j.model ?? "(null)") ?? 0) + 1);
  console.log(`  model providers: ${[...models.entries()].map(([m, n]) => `${m} x${n}`).join(", ")}`);

  const usage = await prisma.apiUsage.findMany({
    where: { day: { gte: new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10) } },
    select: { day: true, count: true },
  });
  const perDayUsage = new Map<string, number>();
  for (const u of usage) perDayUsage.set(u.day, (perDayUsage.get(u.day) ?? 0) + u.count);
  const daily = [...perDayUsage.entries()].sort();
  console.log(`  api-football metered usage (budget 7500/day):`);
  for (const [d, n] of daily.slice(-10)) console.log(`      ${d}  ${String(n).padStart(5)}  ${pct(n, 7500)} of budget`);

  // ---- C. does PREMIUM's floor separate it? ------------------------------
  console.log(`\n--- C. Does PREMIUM's ${PREMIUM_CONFIDENCE_FLOOR} floor separate it from VIP's ${VIP_CONFIDENCE_FLOOR}? ---`);
  const settledEligible = eligible.filter((r) => r.outcome === "WON" || r.outcome === "LOST");
  const at = (floor: number) => {
    const b = settledEligible.filter((r) => r.confidence >= floor);
    return { n: b.length, w: b.filter((r) => r.outcome === "WON").length };
  };
  for (const floor of [75, 78, 80, 82, 85]) {
    const { n, w } = at(floor);
    console.log(`      model confidence >= ${floor}:  n=${String(n).padStart(4)}  strike ${pct(w, n)}`);
  }
  console.log(`  versus separating on the MARKET instead (model >= ${VIP_CONFIDENCE_FLOOR} throughout):`);
  for (const marketFloor of [70, 75, 80, 85]) {
    const b = settledEligible.filter((r) => {
      const c = byKey.get(matchKey(r) ?? "");
      const asOf = c?.fetchedAt ?? new Date();
      const v = evaluateMarketConfirmed({
        marketType: r.marketType, selection: r.selection as Selection, confidence: r.confidence,
        odds: (c?.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: asOf, now: asOf,
      });
      return v.marketProbability != null && v.marketProbability >= marketFloor && (v.bookmakers ?? 0) >= 5;
    });
    console.log(`      market probability >= ${marketFloor}:  n=${String(b.length).padStart(4)}  strike ${pct(b.filter((r) => r.outcome === "WON").length, b.length)}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
