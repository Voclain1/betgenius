/**
 * Research probe for a dedicated VIP-intent / PREMIUM-intent generation pass.
 *
 * Answers, from the database alone — no api-football calls, no model calls,
 * nothing written:
 *
 *   1. Where do today's paid-feed rows actually come from? (provenance mix)
 *   2. How full are VIP and PREMIUM day by day, and how often do they underfill?
 *   3. What has the Market-Confirmed pass — which ALREADY targets VIP+PREMIUM —
 *      produced in production so far?
 *   4. Odds coverage on VIP/PREMIUM-ELIGIBLE fixtures specifically: of rows that
 *      could be paid-tier picks, how many have usable bookmaker prices at all,
 *      at what depth, on which markets?
 *   5. Retro-replay of the Market-Confirmed gate over those eligible rows at
 *      several market floors, with a full rejection-reason histogram — the
 *      yield a dedicated VIP/PREMIUM pass would actually see.
 *   6. Does model confidence alone predict outcome, and does market agreement
 *      predict it better? (the evidence for "confidence floor" vs "cross-check")
 *
 * Run: npx tsx --env-file=.env scripts/research-vip-premium-pass.ts [days]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { matchKey } from "../src/lib/slug";
import { evaluateMarketConfirmed, isEligibleMarketType, devigProbability } from "../src/lib/marketConfirmed";
import { toBookmakerSelection, type FixtureOdds } from "../src/lib/odds";
import type { MarketType, Selection } from "../src/lib/markets";
import { VIP_PROXY_LEAGUE_IDS } from "../src/lib/ai/generationRisk";
import {
  MARKET_CONFIRMED_PROVENANCE,
  VIP_ROUTE_PROVENANCE,
  VIP_CONFIDENCE_FLOOR,
  PREMIUM_CONFIDENCE_FLOOR,
  CURATION_MIN,
} from "../src/lib/geniusCuration";

const DAYS = Number(process.argv[2] ?? 30);
const pct = (n: number, d: number) => (d === 0 ? "  n/a" : `${((n / d) * 100).toFixed(1)}%`);
const lagosDay = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10);

function tally<T extends string>(items: T[]): Array<[T, number]> {
  const m = new Map<T, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86_400_000);
  console.log(`\n=== VIP/PREMIUM dedicated-pass research — last ${DAYS} days (since ${since.toISOString().slice(0, 10)}) ===\n`);

  const rows = await prisma.prediction.findMany({
    where: { kickoff: { gte: since } },
    select: {
      id: true, kickoff: true, createdAt: true, status: true, outcome: true,
      confidence: true, marketType: true, selection: true, provenance: true,
      leagueApiId: true, market: true, pick: true,
      homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true,
      categories: { select: { category: true } },
    },
  });
  const cat = (r: (typeof rows)[number], c: string) => r.categories.some((x) => x.category === c);
  const vipRows = rows.filter((r) => cat(r, "VIP"));
  const premRows = rows.filter((r) => cat(r, "PREMIUM"));

  // ---- 1. provenance mix on the paid feeds -------------------------------
  console.log(`--- 1. Paid-feed provenance mix (rows with kickoff in window) ---`);
  for (const [label, set] of [["VIP", vipRows], ["PREMIUM", premRows]] as const) {
    console.log(`  ${label}: ${set.length} rows`);
    for (const [p, n] of tally(set.map((r) => r.provenance ?? "(null)"))) {
      console.log(`      ${p.padEnd(24)} ${String(n).padStart(4)}  ${pct(n, set.length)}`);
    }
  }
  const identical = vipRows.filter((r) => cat(r, "PREMIUM")).length;
  console.log(`  VIP rows that are ALSO PREMIUM: ${identical} / ${vipRows.length} (${pct(identical, vipRows.length)})`);
  console.log(`  PREMIUM rows that are ALSO VIP: ${identical} / ${premRows.length} (${pct(identical, premRows.length)})\n`);

  // ---- 2. daily fill -----------------------------------------------------
  console.log(`--- 2. Daily fill (published rows per Lagos kickoff day) ---`);
  const days = [...new Set(rows.filter((r) => r.kickoff).map((r) => lagosDay(r.kickoff!)))].sort();
  let vipUnder = 0, premUnder = 0, premEmpty = 0, vipEmpty = 0;
  const vipCounts: number[] = [], premCounts: number[] = [];
  for (const d of days) {
    const v = vipRows.filter((r) => r.kickoff && lagosDay(r.kickoff) === d && r.status === "PUBLISHED").length;
    const p = premRows.filter((r) => r.kickoff && lagosDay(r.kickoff) === d && r.status === "PUBLISHED").length;
    vipCounts.push(v); premCounts.push(p);
    if (v < CURATION_MIN) vipUnder++;
    if (p < CURATION_MIN) premUnder++;
    if (v === 0) vipEmpty++;
    if (p === 0) premEmpty++;
  }
  const mean = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : "0");
  console.log(`  days observed: ${days.length}`);
  console.log(`  VIP     mean/day ${mean(vipCounts)}  days below CURATION_MIN(${CURATION_MIN}): ${vipUnder}  empty days: ${vipEmpty}`);
  console.log(`  PREMIUM mean/day ${mean(premCounts)}  days below CURATION_MIN(${CURATION_MIN}): ${premUnder}  empty days: ${premEmpty}\n`);

  // ---- 3. Market-Confirmed production record -----------------------------
  const mc = rows.filter((r) => r.provenance === MARKET_CONFIRMED_PROVENANCE);
  const mcSettled = mc.filter((r) => r.outcome === "WON" || r.outcome === "LOST");
  console.log(`--- 3. Market-Confirmed (already targets VIP+PREMIUM) production record ---`);
  console.log(`  rows: ${mc.length} over ${days.length} days (${(mc.length / Math.max(1, days.length)).toFixed(2)}/day)`);
  console.log(`  settled: ${mcSettled.length}  won: ${mcSettled.filter((r) => r.outcome === "WON").length}  strike: ${pct(mcSettled.filter((r) => r.outcome === "WON").length, mcSettled.length)}\n`);

  // ---- 4/5. odds coverage + gate replay on VIP/PREMIUM-eligible rows ------
  // "Eligible" = what a dedicated VIP/PREMIUM pass could ever pick from: a row
  // generated under the VIP calibration route (or in the top-12 proxy leagues,
  // which is the same population by construction), above VIP's own floor.
  const eligible = rows.filter(
    (r) =>
      (r.provenance === VIP_ROUTE_PROVENANCE || (VIP_PROXY_LEAGUE_IDS as readonly number[]).includes(r.leagueApiId ?? -1)) &&
      r.confidence >= VIP_CONFIDENCE_FLOOR &&
      r.marketType !== "SAME_GAME_DOUBLE",
  );
  const keys = [...new Set(eligible.map((r) => matchKey(r)).filter((k): k is string => k !== null))];
  const cached = await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: keys } },
    select: { matchKey: true, oddsJson: true, fetchedAt: true, bookmakerCount: true },
  });
  const byKey = new Map(cached.map((c) => [c.matchKey, c]));

  console.log(`--- 4. Odds coverage on VIP/PREMIUM-ELIGIBLE rows (confidence >= ${VIP_CONFIDENCE_FLOOR}, VIP route/top-12 league) ---`);
  console.log(`  eligible rows: ${eligible.length}  distinct fixtures: ${keys.length}`);
  const withCacheRow = keys.filter((k) => byKey.has(k)).length;
  const withOdds = keys.filter((k) => byKey.get(k)?.oddsJson).length;
  console.log(`  fixtures with a cache row:     ${withCacheRow}  ${pct(withCacheRow, keys.length)}`);
  console.log(`  fixtures with real oddsJson:   ${withOdds}  ${pct(withOdds, keys.length)}`);
  const depths = keys.map((k) => byKey.get(k)?.bookmakerCount ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p: number) => (depths.length ? depths[Math.min(depths.length - 1, Math.floor(depths.length * p))] : 0);
  console.log(`  bookmaker depth on priced fixtures: p10 ${q(0.1)}  median ${q(0.5)}  p90 ${q(0.9)}  (n=${depths.length})`);
  console.log(`  fixtures with >= 5 bookmakers: ${depths.filter((d) => d >= 5).length}  ${pct(depths.filter((d) => d >= 5).length, keys.length)}`);

  // market-type breakdown of eligible rows, and whether their exact selection is quoted
  console.log(`\n  eligible rows by marketType (MC-eligible types marked *):`);
  for (const [mt, n] of tally(eligible.map((r) => r.marketType))) {
    console.log(`      ${isEligibleMarketType(mt) ? "*" : " "} ${mt.padEnd(20)} ${String(n).padStart(4)}  ${pct(n, eligible.length)}`);
  }
  let quoted = 0, quotable = 0;
  for (const r of eligible) {
    if (!isEligibleMarketType(r.marketType)) continue;
    quotable++;
    const c = byKey.get(matchKey(r) ?? "");
    const odds = (c?.oddsJson as unknown as FixtureOdds | null) ?? null;
    if (!odds) continue;
    const mapped = toBookmakerSelection(r.marketType as MarketType, r.selection as Selection);
    if (mapped && devigProbability(odds, mapped.market, mapped.value)) quoted++;
  }
  console.log(`\n  rows on an MC-eligible market: ${quotable} / ${eligible.length}  ${pct(quotable, eligible.length)}`);
  console.log(`  ...whose EXACT selection is fully quoted: ${quoted}  ${pct(quoted, quotable)}\n`);

  // ---- 5. gate replay at several market floors ---------------------------
  console.log(`--- 5. Gate replay on eligible rows (staleness neutralised: historical quotes) ---`);
  type Replay = { row: (typeof eligible)[number]; marketProb: number | null; gap: number | null; reason?: string; books: number | null };
  const replays: Replay[] = [];
  for (const r of eligible) {
    const c = byKey.get(matchKey(r) ?? "");
    const odds = (c?.oddsJson as unknown as FixtureOdds | null) ?? null;
    const asOf = c?.fetchedAt ?? new Date();
    const v = evaluateMarketConfirmed({
      marketType: r.marketType,
      selection: r.selection as Selection,
      confidence: r.confidence,
      odds,
      // Replay the quote as if fresh: this measures gate SHAPE, not whether a
      // months-old cache row is inside a 2h window it was never asked to meet.
      fetchedAt: asOf,
      now: asOf,
    });
    replays.push({ row: r, marketProb: v.marketProbability, gap: v.gapPP, reason: v.confirmed ? undefined : v.reason, books: v.bookmakers });
  }
  console.log(`  rejection reasons over ${replays.length} eligible rows:`);
  for (const [reason, n] of tally(replays.map((x) => x.reason ?? "CONFIRMED"))) {
    console.log(`      ${reason.padEnd(22)} ${String(n).padStart(4)}  ${pct(n, replays.length)}`);
  }
  const perDay = (n: number) => (n / Math.max(1, days.length)).toFixed(2);
  console.log(`\n  yield at combinations of (model floor, market floor, max gap):`);
  console.log(`      modelFloor marketFloor maxGap   picks  picks/day  settled  strike`);
  for (const modelFloor of [VIP_CONFIDENCE_FLOOR, PREMIUM_CONFIDENCE_FLOOR, 85]) {
    for (const marketFloor of [70, 75, 80]) {
      for (const maxGap of [10, 15]) {
        const pass = replays.filter(
          (x) =>
            x.row.confidence >= modelFloor &&
            x.marketProb != null && x.marketProb >= marketFloor &&
            x.gap != null && x.gap <= maxGap &&
            (x.books ?? 0) >= 5,
        );
        const s = pass.filter((x) => x.row.outcome === "WON" || x.row.outcome === "LOST");
        const w = s.filter((x) => x.row.outcome === "WON").length;
        console.log(
          `      ${String(modelFloor).padStart(10)} ${String(marketFloor).padStart(11)} ${String(maxGap).padStart(6)}   ${String(pass.length).padStart(5)}  ${perDay(pass.length).padStart(9)}  ${String(s.length).padStart(7)}  ${pct(w, s.length).padStart(6)}`,
        );
      }
    }
  }

  // ---- 6. does confidence alone predict outcome? -------------------------
  console.log(`\n--- 6. Confidence alone vs market agreement, on settled eligible rows ---`);
  const settled = replays.filter((x) => x.row.outcome === "WON" || x.row.outcome === "LOST");
  console.log(`  settled eligible rows: ${settled.length}`);
  console.log(`  by MODEL confidence band:`);
  for (const [lo, hi] of [[75, 80], [80, 85], [85, 90], [90, 101]] as const) {
    const b = settled.filter((x) => x.row.confidence >= lo && x.row.confidence < hi);
    const w = b.filter((x) => x.row.outcome === "WON").length;
    console.log(`      ${lo}-${hi === 101 ? "100" : hi}  n=${String(b.length).padStart(4)}  strike ${pct(w, b.length)}`);
  }
  console.log(`  by DE-VIGGED MARKET probability band (model confidence held >= ${VIP_CONFIDENCE_FLOOR}):`);
  for (const [lo, hi] of [[0, 65], [65, 70], [70, 75], [75, 80], [80, 101]] as const) {
    const b = settled.filter((x) => x.marketProb != null && x.marketProb >= lo && x.marketProb < hi);
    const w = b.filter((x) => x.row.outcome === "WON").length;
    console.log(`      ${String(lo).padStart(3)}-${hi === 101 ? "100" : hi}  n=${String(b.length).padStart(4)}  strike ${pct(w, b.length)}`);
  }
  console.log(`  by AGREEMENT (|model - market|), both above their floors:`);
  for (const [lo, hi] of [[0, 5], [5, 10], [10, 15], [15, 1000]] as const) {
    const b = settled.filter((x) => x.gap != null && x.gap >= lo && x.gap < hi);
    const w = b.filter((x) => x.row.outcome === "WON").length;
    console.log(`      ${String(lo).padStart(3)}-${hi === 1000 ? "inf" : hi}pp  n=${String(b.length).padStart(4)}  strike ${pct(w, b.length)}`);
  }
  const noOdds = settled.filter((x) => x.reason === "NO_ODDS" || x.reason === "MARKET_NOT_QUOTED" || x.reason === "INELIGIBLE_MARKET");
  console.log(`  rows the market could NOT be consulted on: n=${noOdds.length}  strike ${pct(noOdds.filter((x) => x.row.outcome === "WON").length, noOdds.length)}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
