/**
 * Diagnoses the market-risk calibration against real generated predictions.
 *
 * Two questions, in order:
 *
 *   1. What IS the real market-type distribution? An impression of "90%+
 *      Double Chance" is worth checking rather than acting on — the whole
 *      point of measuring is that the fix should address the actual shape.
 *
 *   2. Does market choice track fixture lopsidedness AT ALL? This is the real
 *      diagnostic. A hedging rule that is working produces straight
 *      MATCH_WINNER on extreme mismatches and hedges on close games. A hedging
 *      rule that has overcorrected produces the same market regardless of
 *      margin — flat across every band. Lopsidedness is measured from the
 *      market's own 1X2 prices in FixtureOddsCache, so it is an independent
 *      yardstick rather than a restatement of the model's own confidence.
 *
 * Read-only. Spends no api-football quota.
 *
 * Run: npx tsx --env-file=.env scripts/measure-market-calibration.ts [days]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { matchKey } from "../src/lib/slug";
import { impliedProbability, findSelection, type FixtureOdds } from "../src/lib/odds";
import { resolveGenerationRisk } from "../src/lib/ai/generationRisk";

/** Favourite's implied probability, from the market's own 1X2 line. */
function favouriteProbability(odds: FixtureOdds | null): number | null {
  if (!odds) return null;
  const mw = odds.markets.find((m) => m.market === "Match Winner");
  if (!mw) return null;
  const prices = ["Home", "Draw", "Away"]
    .map((v) => findSelection(odds, "Match Winner", v)?.best)
    .filter((p): p is number => p != null);
  if (prices.length < 3) return null;
  // Shortest price = favourite. Normalised by the overround so the figure is a
  // probability rather than a bookmaker's margin-inflated price.
  const raw = prices.map(impliedProbability);
  const overround = raw.reduce((a, b) => a + b, 0) / 100;
  return Math.max(...raw) / overround;
}

const BANDS = [
  { label: "close       (fav < 45%)", lo: 0, hi: 45 },
  { label: "moderate    (45-60%)", lo: 45, hi: 60 },
  { label: "strong      (60-75%)", lo: 60, hi: 75 },
  { label: "extreme     (75%+)", lo: 75, hi: 101 },
] as const;

async function main() {
  const days = Number(process.argv[2]) || 14;
  const since = new Date(Date.now() - days * 86_400_000);

  // Generated predictions only, with the tier they were generated under
  // recomputed from the recorded intent — the same resolution generation used.
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: since } },
    select: {
      prompt: true,
      createdAt: true,
      predictions: {
        select: {
          id: true, marketType: true, selection: true, confidence: true, outcome: true,
          leagueApiId: true, homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true,
        },
      },
    },
  });

  type Row = (typeof jobs)[number]["predictions"][number] & { tier: string; intent: string };
  const rows: Row[] = [];
  for (const j of jobs) {
    let categories: string[] = [];
    try { categories = JSON.parse(j.prompt)?.categories ?? []; } catch {}
    for (const p of j.predictions) {
      const route = resolveGenerationRisk(categories, p.leagueApiId);
      rows.push({ ...p, tier: route.promptTiers.join("+"), intent: categories.join("+") || "(none)" });
    }
  }

  if (rows.length === 0) {
    console.log(`No generated predictions in the last ${days} days.`);
    await prisma.$disconnect();
    return;
  }

  // ---------- 1. Real distribution ----------
  const count = (xs: Row[]) => {
    const c: Record<string, number> = {};
    for (const r of xs) c[r.marketType] = (c[r.marketType] ?? 0) + 1;
    return c;
  };
  const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(1)}%`;

  console.log(`=== 1. MARKET-TYPE DISTRIBUTION (last ${days} days, ${rows.length} generated predictions) ===`);
  const overall = count(rows);
  for (const [m, n] of Object.entries(overall).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${m.padEnd(15)} ${String(n).padStart(4)}  ${pct(n, rows.length).padStart(6)}`);
  }

  console.log(`\n--- by prompt tier (what the calibration rule actually saw) ---`);
  const tiers = [...new Set(rows.map((r) => r.tier))];
  for (const t of tiers) {
    const sub = rows.filter((r) => r.tier === t);
    const c = count(sub);
    const dc = c.DOUBLE_CHANCE ?? 0;
    console.log(`  tier ${t.padEnd(8)} n=${String(sub.length).padStart(4)}  DOUBLE_CHANCE ${pct(dc, sub.length).padStart(6)}  ${JSON.stringify(c)}`);
  }

  // ---------- 2. Does market choice track lopsidedness? ----------
  const keys = [...new Set(rows.map((r) => matchKey(r)).filter((k): k is string => !!k))];
  const cached = keys.length
    ? await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys }, fetchedAt: { not: null } }, select: { matchKey: true, oddsJson: true } })
    : [];
  const oddsByKey = new Map(cached.map((c) => [c.matchKey, (c.oddsJson as unknown as FixtureOdds | null) ?? null]));

  const withOdds = rows
    .map((r) => {
      const key = matchKey(r);
      const fav = favouriteProbability(key ? (oddsByKey.get(key) ?? null) : null);
      return fav == null ? null : { ...r, fav };
    })
    .filter((r): r is Row & { fav: number } => r !== null);

  console.log(`\n=== 2. MARKET CHOICE vs FIXTURE LOPSIDEDNESS (${withOdds.length} of ${rows.length} have cached prices) ===`);
  if (withOdds.length === 0) {
    console.log("  no overlap between generated predictions and cached odds — cannot answer the diagnostic");
  } else {
    console.log(`  ${"band".padEnd(24)} ${"n".padStart(4)} ${"MATCH_WINNER".padStart(13)} ${"DOUBLE_CHANCE".padStart(14)} ${"other".padStart(7)}  meanFav  meanConf`);
    for (const b of BANDS) {
      const sub = withOdds.filter((r) => r.fav >= b.lo && r.fav < b.hi);
      if (sub.length === 0) {
        console.log(`  ${b.label.padEnd(24)} ${String(0).padStart(4)}  (none)`);
        continue;
      }
      const mw = sub.filter((r) => r.marketType === "MATCH_WINNER").length;
      const dc = sub.filter((r) => r.marketType === "DOUBLE_CHANCE").length;
      const other = sub.length - mw - dc;
      const meanFav = sub.reduce((a, r) => a + r.fav, 0) / sub.length;
      const meanConf = sub.reduce((a, r) => a + r.confidence, 0) / sub.length;
      console.log(
        `  ${b.label.padEnd(24)} ${String(sub.length).padStart(4)} ${pct(mw, sub.length).padStart(13)} ${pct(dc, sub.length).padStart(14)} ${pct(other, sub.length).padStart(7)}  ${meanFav.toFixed(1)}%   ${meanConf.toFixed(1)}%`,
      );
    }

    // The headline: if hedging tracked lopsidedness, MATCH_WINNER share would
    // climb sharply from the close band to the extreme one.
    const closeBand = withOdds.filter((r) => r.fav < 45);
    const extremeBand = withOdds.filter((r) => r.fav >= 75);
    const share = (xs: typeof withOdds) => (xs.length ? (xs.filter((r) => r.marketType === "MATCH_WINNER").length / xs.length) * 100 : null);
    const closeShare = share(closeBand);
    const extremeShare = share(extremeBand);
    console.log(`\n  MATCH_WINNER share, close fixtures:   ${closeShare == null ? "n/a" : closeShare.toFixed(1) + "%"} (n=${closeBand.length})`);
    console.log(`  MATCH_WINNER share, extreme mismatch: ${extremeShare == null ? "n/a" : extremeShare.toFixed(1) + "%"} (n=${extremeBand.length})`);
    // A verdict needs enough fixtures in BOTH end bands to mean anything. The
    // first run of this script declared "market choice does track lopsidedness"
    // off an extreme band containing exactly one fixture — a conclusion with no
    // sample behind it, which is precisely the failure this guard prevents.
    const MIN_BAND = 5;
    if (closeShare == null || extremeShare == null || closeBand.length < MIN_BAND || extremeBand.length < MIN_BAND) {
      console.log(`
  VERDICT: INCONCLUSIVE — need >= ${MIN_BAND} fixtures in both end bands (close n=${closeBand.length}, extreme n=${extremeBand.length}).`);
      // The middle bands still carry a readable signal even when the ends are
      // thin: if hedging were working, MATCH_WINNER share would RISE with the
      // favourite's probability. Falling or flat is the bug's signature.
      const trend = BANDS.map((b) => {
        const sub = withOdds.filter((r) => r.fav >= b.lo && r.fav < b.hi);
        return { label: b.label.trim(), n: sub.length, mw: sub.length ? (sub.filter((r) => r.marketType === "MATCH_WINNER").length / sub.length) * 100 : null };
      }).filter((t) => t.n >= MIN_BAND);
      if (trend.length >= 2) {
        const rising = trend[trend.length - 1].mw! > trend[0].mw!;
        console.log(`  partial signal across bands with n>=${MIN_BAND}: ${trend.map((t) => `${t.label} ${t.mw!.toFixed(0)}%`).join("  ->  ")}`);
        console.log(`  MATCH_WINNER share is ${rising ? "rising" : "flat or falling"} with lopsidedness${rising ? "" : " — the signature of a hedging rule that does not differentiate"}.`);
      }
    } else {
      const delta = extremeShare - closeShare;
      console.log(`
  differentiation: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp`);
      console.log(
        delta < 15
          ? "  VERDICT: market choice is effectively FLAT across lopsidedness — the hedging rule is not differentiating."
          : "  VERDICT: market choice does track lopsidedness.",
      );
    }

    // Cross-check: are we hedging fixtures the market itself calls near-certain?
    const veryLopsided = withOdds.filter((r) => r.fav >= 80);
    const hedgedAnyway = veryLopsided.filter((r) => r.marketType !== "MATCH_WINNER");
    console.log(`\n  fixtures the market prices at 80%+ for the favourite: ${veryLopsided.length}`);
    console.log(`  ...of which we did NOT take the straight winner: ${hedgedAnyway.length} (${veryLopsided.length ? pct(hedgedAnyway.length, veryLopsided.length) : "n/a"})`);
  }

  await prisma.$disconnect();
}

main();
