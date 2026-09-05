/**
 * Research probe: can odds-tier accumulators be assembled from REAL cached
 * prices, or would they have to be estimated from confidence?
 *
 * Answers, from the database only — no API calls, no writes:
 *   1. Coverage   — what fraction of a typical day's published picks in the
 *                   four headline markets have a real, resolvable price?
 *   2. Depth      — are those prices market prices (MIN_BOOKMAKERS deep) or
 *                   one book quoting into the void?
 *   3. Shape      — what does the priced pool's odds distribution look like,
 *                   which is what decides whether a tier is reachable at all.
 *   4. Feasibility— for each target tier, can a combination of DISTINCT
 *                   fixtures actually land in the band, and at what leg count
 *                   and what minimum leg confidence?
 *
 * The resolution step is deliberately the SAME one Bet of the Day uses —
 * toBookmakerSelection() then findSelection() — rather than a re-implementation.
 * A probe that resolved prices more loosely than the feature would report
 * coverage the feature could not actually achieve.
 *
 * Read-only. Run: npx tsx --env-file=.env scripts/research-accumulator-tiers.ts
 */
export {};

import { PrismaClient } from "@prisma/client";
import { toBookmakerSelection, findSelection, MIN_BOOKMAKERS, type FixtureOdds } from "../src/lib/odds";
import { matchKey } from "../src/lib/slug";

const prisma = new PrismaClient();

/** The tiers the proposal is about. */
const TIERS = [3, 5, 10, 15, 20, 50];
/** A combination counts as hitting a tier if its product lands in [T, T*BAND]. */
const BAND = 1.25;
/** No accumulator may take two legs from one fixture — they are not independent, and books block it. */
const MAX_LEGS = 8;
/** How many days back to sample, so "a typical day" is a measurement and not one lucky Saturday. */
const DAYS = 10;

type Leg = { fixture: string; label: string; market: string; pick: string; odds: number; books: number; confidence: number };

const pct = (n: number, d: number) => (d === 0 ? "  n/a" : `${((n / d) * 100).toFixed(1).padStart(5)}%`);
const quantile = (sorted: number[], q: number) => {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/**
 * Cheapest combination of DISTINCT fixtures whose odds product lands in the
 * tier band, preferring fewer legs and then the highest floor confidence.
 *
 * Depth-first over odds sorted descending with a hard product ceiling, so the
 * search prunes instead of enumerating: once the running product exceeds the
 * band's top there is no way back down (every odd is > 1), so that whole
 * subtree dies. Returns the first solution at the smallest leg count, which is
 * what a reader would actually want — a 10x built from 3 legs is a better bet
 * than the same 10x built from 7.
 */
function findCombo(pool: Leg[], target: number, minConfidence: number): Leg[] | null {
  const eligible = pool.filter((l) => l.confidence >= minConfidence).sort((a, b) => b.odds - a.odds);
  const hi = target * BAND;
  for (let legs = 2; legs <= MAX_LEGS; legs++) {
    let best: Leg[] | null = null;
    let bestFloor = -1;
    let budget = 400_000;
    const walk = (start: number, chosen: Leg[], product: number) => {
      if (budget-- <= 0) return;
      if (chosen.length === legs) {
        if (product >= target && product <= hi) {
          const floor = Math.min(...chosen.map((c) => c.confidence));
          if (floor > bestFloor) { bestFloor = floor; best = [...chosen]; }
        }
        return;
      }
      for (let i = start; i < eligible.length; i++) {
        const next = product * eligible[i].odds;
        if (next > hi) continue;               // too big already — and they only get bigger
        if (chosen.some((c) => c.fixture === eligible[i].fixture)) continue;
        chosen.push(eligible[i]);
        walk(i + 1, chosen, next);
        chosen.pop();
      }
    };
    walk(0, [], 1);
    if (best) return best;
  }
  return null;
}

(async () => {
  console.log(`Sampling the last ${DAYS} days of PUBLISHED predictions.\n`);

  const since = new Date(Date.now() - DAYS * 24 * 3_600_000);
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: since }, homeTeam: { not: null }, awayTeam: { not: null } },
    select: {
      homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true,
      marketType: true, selection: true, market: true, pick: true, confidence: true, leagueName: true,
    },
    orderBy: { kickoff: "asc" },
  });

  const keys = [...new Set(rows.map((r) => matchKey(r)).filter((k): k is string => k !== null))];
  const cacheRows = await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: keys } },
    select: { matchKey: true, oddsJson: true, fetchedAt: true, bookmakerCount: true },
  });
  const oddsByKey = new Map(cacheRows.filter((c) => c.fetchedAt).map((c) => [c.matchKey, c.oddsJson as unknown as FixtureOdds | null]));

  // ---- 1 & 2. Coverage and depth -----------------------------------------
  const HEADLINE_TYPES = new Set(["MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS"]);
  const byDay = new Map<string, { total: number; headline: number; cached: number; mapped: number; priced: number; deep: number; legs: Leg[] }>();

  let total = 0, headline = 0, cached = 0, mapped = 0, priced = 0, deep = 0;
  const allPrices: number[] = [];

  for (const r of rows) {
    const day = r.kickoff!.toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { total: 0, headline: 0, cached: 0, mapped: 0, priced: 0, deep: 0, legs: [] });
    const d = byDay.get(day)!;
    total++; d.total++;

    if (!HEADLINE_TYPES.has(r.marketType)) continue;
    headline++; d.headline++;

    const key = matchKey(r);
    if (!key || !oddsByKey.has(key)) continue;
    cached++; d.cached++;
    const odds = oddsByKey.get(key) ?? null;

    const bk = toBookmakerSelection(r.marketType, r.selection);
    if (!bk) continue;
    mapped++; d.mapped++;

    const sel = findSelection(odds, bk.market, bk.value);
    if (!sel) continue;
    priced++; d.priced++;
    allPrices.push(sel.best);

    if (sel.bookmakers < MIN_BOOKMAKERS) continue;
    deep++; d.deep++;
    d.legs.push({
      fixture: key,
      label: `${r.homeTeam} vs ${r.awayTeam}`,
      market: r.market, pick: r.pick,
      odds: sel.best, books: sel.bookmakers, confidence: r.confidence,
    });
  }

  console.log("COVERAGE — each step is a filter the feature would also have to pass:");
  console.log(`  published picks sampled                  ${String(total).padStart(6)}`);
  console.log(`  in the four headline markets             ${String(headline).padStart(6)}  ${pct(headline, total)} of published`);
  console.log(`  ...whose fixture has an odds cache row   ${String(cached).padStart(6)}  ${pct(cached, headline)} of headline`);
  console.log(`  ...whose selection maps to a book label  ${String(mapped).padStart(6)}  ${pct(mapped, headline)} of headline`);
  console.log(`  ...with a REAL price for that selection  ${String(priced).padStart(6)}  ${pct(priced, headline)} of headline`);
  console.log(`  ...quoted by >= ${MIN_BOOKMAKERS} bookmakers            ${String(deep).padStart(6)}  ${pct(deep, headline)} of headline`);

  // ---- 3. Shape of the priced pool ---------------------------------------
  const sorted = [...allPrices].sort((a, b) => a - b);
  console.log("\nPRICE DISTRIBUTION of resolvable picks (best price):");
  if (sorted.length) {
    console.log(`  n=${sorted.length}  min ${sorted[0].toFixed(2)}  p25 ${quantile(sorted, 0.25).toFixed(2)}  median ${quantile(sorted, 0.5).toFixed(2)}  p75 ${quantile(sorted, 0.75).toFixed(2)}  p90 ${quantile(sorted, 0.9).toFixed(2)}  max ${sorted[sorted.length - 1].toFixed(2)}`);
  } else {
    console.log("  (nothing resolvable — the feature cannot run on real prices)");
  }

  // ---- 4. Per-day tier feasibility ---------------------------------------
  console.log("\nPER-DAY POOL AND TIER FEASIBILITY (legs needed, '-' = unreachable):");
  console.log("  day         picks  headline  priced  deep   " + TIERS.map((t) => `${t}x`.padStart(5)).join(" ") + "   maxProduct");
  const hit: Record<number, number> = Object.fromEntries(TIERS.map((t) => [t, 0]));
  const legCounts: Record<number, number[]> = Object.fromEntries(TIERS.map((t) => [t, [] as number[]]));
  let days = 0;

  for (const [day, d] of [...byDay.entries()].sort()) {
    if (d.total === 0) continue;
    days++;
    // Best achievable product: one leg per fixture, highest price each, top MAX_LEGS.
    const perFixture = new Map<string, Leg>();
    for (const l of d.legs) {
      const cur = perFixture.get(l.fixture);
      if (!cur || l.odds > cur.odds) perFixture.set(l.fixture, l);
    }
    const top = [...perFixture.values()].sort((a, b) => b.odds - a.odds).slice(0, MAX_LEGS);
    const maxProduct = top.reduce((p, l) => p * l.odds, 1);

    const cells = TIERS.map((t) => {
      const combo = findCombo(d.legs, t, 0);
      if (combo) { hit[t]++; legCounts[t].push(combo.length); return String(combo.length).padStart(5); }
      return "    -";
    });
    console.log(`  ${day}  ${String(d.total).padStart(5)}  ${String(d.headline).padStart(8)}  ${String(d.priced).padStart(6)}  ${String(d.deep).padStart(4)}   ${cells.join(" ")}   ${maxProduct >= 1000 ? maxProduct.toExponential(1) : maxProduct.toFixed(0)}`);
  }

  console.log("\nTIER YIELD across the sample:");
  for (const t of TIERS) {
    const counts = legCounts[t];
    const median = counts.length ? quantile([...counts].sort((a, b) => a - b), 0.5) : NaN;
    console.log(`  ${String(t).padStart(2)}x  reachable on ${String(hit[t]).padStart(2)}/${days} days  ${pct(hit[t], days)}   median legs ${counts.length ? median.toFixed(1) : "n/a"}`);
  }

  // ---- 5. Does a confidence floor kill the high tiers? --------------------
  console.log("\nEFFECT OF A MINIMUM LEG CONFIDENCE (does a floor starve the high tiers?):");
  console.log("  floor   " + TIERS.map((t) => `${t}x`.padStart(6)).join(" "));
  for (const floor of [0, 55, 60, 65, 70]) {
    const cells = TIERS.map((t) => {
      let n = 0;
      for (const [, d] of byDay) if (d.total && findCombo(d.legs, t, floor)) n++;
      return `${n}/${days}`.padStart(6);
    });
    console.log(`  ${String(floor).padStart(3)}%   ${cells.join(" ")}`);
  }

  // ---- 5b. The window the feature would actually run in -------------------
  // getScopedOddsTargets refreshes TODAY's published picks that are still
  // ahead of kickoff. So a retrospective 10-day figure understates what a
  // same-day curation job sees: it counts days whose fixtures had already
  // kicked off before the odds workload ever reached them. This slice is the
  // operationally relevant one — picks that were priced BEFORE kickoff.
  console.log("\nOPERATIONAL WINDOW — picks whose fixture was still ahead of kickoff when priced:");
  const fresh = await prisma.fixtureOddsCache.findMany({
    where: { fetchedAt: { not: null } },
    select: { matchKey: true, fetchedAt: true },
  });
  const fetchedAtByKey = new Map(fresh.map((f) => [f.matchKey, f.fetchedAt!]));
  let preKick = 0, preKickPriced = 0;
  for (const r of rows) {
    if (!HEADLINE_TYPES.has(r.marketType)) continue;
    const key = matchKey(r);
    if (!key) continue;
    const at = fetchedAtByKey.get(key);
    // "Would a same-day job have had a price?" — the cache row exists AND was
    // written before this fixture kicked off.
    const inWindow = at ? at.getTime() < r.kickoff!.getTime() : false;
    if (!at) { preKick++; continue; }
    if (!inWindow) continue;
    preKick++;
    const bk = toBookmakerSelection(r.marketType, r.selection);
    if (bk && findSelection(oddsByKey.get(key) ?? null, bk.market, bk.value)) preKickPriced++;
  }
  console.log(`  headline picks                           ${String(preKick).padStart(6)}`);
  console.log(`  ...priced before kickoff                 ${String(preKickPriced).padStart(6)}  ${pct(preKickPriced, preKick)}`);

  // ---- 6. What does a tier actually LOOK like? ---------------------------
  // The 50x question is not "is it reachable" but "is it reachable from picks
  // with real analysis behind them, or only by stacking the longest shots on
  // the board". Printing the chosen legs is the only way to answer that.
  const richest = [...byDay.entries()].filter(([, d]) => d.deep >= 40).sort((a, b) => b[1].deep - a[1].deep)[0];
  if (richest) {
    const [day, d] = richest;
    console.log(`\nWORKED EXAMPLE — ${day} (${d.deep} deep-priced legs available):`);
    for (const t of TIERS) {
      const combo = findCombo(d.legs, t, 60);
      if (!combo) { console.log(`\n  ${t}x — UNREACHABLE at a 60% confidence floor`); continue; }
      const product = combo.reduce((p, l) => p * l.odds, 1);
      const floor = Math.min(...combo.map((c) => c.confidence));
      console.log(`\n  ${t}x target -> ${product.toFixed(2)} from ${combo.length} legs, lowest leg confidence ${floor}%`);
      for (const l of combo) {
        console.log(`      ${l.odds.toFixed(2).padStart(5)}  ${String(l.confidence).padStart(3)}%  ${l.books.toString().padStart(2)} books  ${l.label} — ${l.pick}`);
      }
    }
  }

  // ---- 7. Confidence shape of the usable pool ----------------------------
  const confs = [...byDay.values()].flatMap((d) => d.legs.map((l) => l.confidence)).sort((a, b) => a - b);
  if (confs.length) {
    console.log(`\nCONFIDENCE of deep-priced legs: n=${confs.length}  min ${confs[0]}  p10 ${quantile(confs, 0.1).toFixed(0)}  median ${quantile(confs, 0.5).toFixed(0)}  p90 ${quantile(confs, 0.9).toFixed(0)}  max ${confs[confs.length - 1]}`);
  }

  await prisma.$disconnect();
})();
