/**
 * Sprint 05 validation: existing VIP / PREMIUM selection against the proposed
 * quality-first policies, on settled history, split chronologically.
 *
 * Universe: published, settled single predictions with confidence >= 75 (the
 * VIP floor) over the window, any feed. Prices: a dedicated pick's recorded
 * entry price where one exists (verifiedEntryPrice); otherwise the fixture's
 * last PRE-KICKOFF cached quote, labelled "closing" because it is later than
 * publication. A quote taken after kickoff is never used. Rows with no price
 * stay in win-rate figures and are excluded from ROI; the missing-odds
 * sensitivity shows ROI if every unpriced pick had lost.
 *
 * Bars are QUALITY_POLICY, fixed before this ran. Windows: the whole span and
 * two later sub-windows (last 60 and last 30 days) for stability.
 *
 * READ-ONLY. No provider calls, no writes.
 * Run: npx tsx --env-file=.env scripts/validate-paid-candidate-quality.ts [days=120]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import { matchKey } from "../src/lib/slug";
import type { FixtureOdds } from "../src/lib/odds";
import { pickPrice } from "../src/lib/paidSelection";
import { verifiedEntryPrice } from "../src/lib/paidEntryEvidence";
import { PAID_ANY_LEAGUE_IDS } from "../src/lib/vipPremiumOverlay";
import { generationTierOf } from "../src/lib/leagues";
import { comparePolicies, missingOddsSensitivity, selectByPolicy, type PolicyWindow, type ValidationRow } from "../src/lib/paidPolicyValidation";
import { QUALITY_POLICY, QUALITY_POLICY_VERSION } from "../src/lib/paidCandidateQuality";

const DAY = 86_400_000;
const pct = (x: number | null, d = 1) => (x == null ? "—" : `${(100 * x).toFixed(d)}%`);
const fmt = (w: PolicyWindow) =>
  `n ${String(w.n).padStart(4)} W/L/V ${w.wins}/${w.losses}/${w.voids} win ${pct(w.winRate)} [${w.wilson95 ? w.wilson95.map((x) => pct(x)).join("–") : "—"}]`
  + ` priced ${w.priced} ROI ${w.roiPct == null ? "n<30" : `${w.roiPct.toFixed(1)}%`} odds ${w.meanOdds?.toFixed(2) ?? "—"}`
  + ` vsMkt ${w.winsOverMarket == null ? "—" : w.winsOverMarket.toFixed(1)} topLeague ${pct(w.topLeagueShare, 0)} max/day ${w.maxPerDay}`;

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error(`refusing: session is not read-only (transaction_read_only = ${ro?.transaction_read_only})`);
    console.log("session verified read-only (transaction_read_only = on)");
  }
  const days = Math.min(365, Math.max(14, Number(process.argv[2]) || 120));
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY);
  const raw = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED", outcome: { in: ["WON", "LOST", "VOID"] }, confidence: { gte: QUALITY_POLICY.VIP.minConfidence },
      kickoff: { gte: since, lt: now }, marketType: { not: "SAME_GAME_DOUBLE" },
    },
    select: {
      id: true, kickoff: true, leagueApiId: true, marketType: true, selection: true, confidence: true, outcome: true,
      homeTeamApiId: true, awayTeamApiId: true, marketConfirmation: true, categories: { select: { category: true } },
    },
    take: 30_000,
  });
  const rowsIn = raw.filter((r) => r.kickoff && !r.categories.some((c) => c.category === "SAME_GAME_DOUBLE"));
  const keys = [...new Set(rowsIn.map((r) => matchKey(r)).filter((k): k is string => !!k))];
  const quotes = new Map<string, { oddsJson: FixtureOdds | null; fetchedAt: Date | null }>();
  for (let i = 0; i < keys.length; i += 500) {
    for (const q of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true } })) {
      quotes.set(q.matchKey, { oddsJson: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt });
    }
  }

  let postKickoff = 0;
  const rows: ValidationRow[] = rowsIn.map((r) => {
    const kickoff = r.kickoff!;
    const key = matchKey(r) ?? `id:${r.id}`;
    const q = quotes.get(key);
    const pre = !!q?.fetchedAt && q.fetchedAt < kickoff;
    if (q?.fetchedAt && !pre) postKickoff++;
    const price = pre ? pickPrice(q!.oddsJson, r.marketType, r.selection) : null;
    const entry = verifiedEntryPrice(r.marketConfirmation, kickoff);
    const mc = r.marketConfirmation as any;
    const executable = price && !price.derived ? price : null;
    const odds = entry ?? executable?.median ?? null;
    return {
      id: r.id, fixtureKey: key, leagueApiId: r.leagueApiId, marketType: r.marketType,
      selection: typeof r.selection === "string" ? r.selection : JSON.stringify(r.selection ?? null),
      kickoff, confidence: r.confidence, odds,
      marketProbability: entry && typeof mc?.marketProbability === "number" ? mc.marketProbability : executable?.fair ?? null,
      bookmakers: entry && typeof mc?.bookmakers === "number" ? mc.bookmakers : executable?.bookmakers ?? null,
      derivedPrice: !!price?.derived && !entry,
      quoteFetchedAt: entry && typeof mc?.quoteFetchedAt === "string" ? new Date(mc.quoteFetchedAt) : pre ? q!.fetchedAt : null,
      calibratedLower: null, expectedValueLower: null,
      outcome: r.outcome as ValidationRow["outcome"],
      categories: r.categories.map((c) => c.category),
      inPaidScope: PAID_ANY_LEAGUE_IDS.includes(r.leagueApiId ?? -1),
      day: lagosDateKey(kickoff),
      priceSource: entry ? "entry" : executable ? "closing" : "missing",
    };
  });
  // Closing quotes are judged at their own fetch time, so the freshness bar is
  // measured against that moment: equivalent to "a fresh quote existed".
  console.log(`policy ${QUALITY_POLICY_VERSION}; window ${since.toISOString().slice(0, 10)}..${now.toISOString().slice(0, 10)} (${days}d)`);
  console.log(`universe: ${rows.length} settled published singles at confidence >= ${QUALITY_POLICY.VIP.minConfidence}; `
    + `entry-priced ${rows.filter((r) => r.priceSource === "entry").length}, closing-priced ${rows.filter((r) => r.priceSource === "closing").length}, `
    + `unpriced ${rows.filter((r) => r.priceSource === "missing").length}; post-kickoff quotes discarded ${postKickoff}`);
  const byTier: Record<string, number> = {};
  for (const r of rows) { const t = generationTierOf(r.leagueApiId) ?? "UNCATALOGUED"; byTier[t] = (byTier[t] ?? 0) + 1; }
  console.log("universe by generation tier:", JSON.stringify(byTier));

  for (const windowDays of [days, 60, 30]) {
    const from = new Date(now.getTime() - windowDays * DAY);
    const w = rows.filter((r) => r.kickoff >= from);
    for (const tier of ["VIP", "PREMIUM"] as const) {
      const { splitAt, results } = comparePolicies(w, tier);
      console.log(`\n== ${tier}, last ${windowDays}d (${w.length} rows), holdout from ${splitAt?.slice(0, 16) ?? "—"} ==`);
      for (const r of results) {
        console.log(`  ${r.policy.padEnd(18)} all      ${fmt(r.all)}`);
        console.log(`  ${"".padEnd(18)} training ${fmt(r.training)}`);
        console.log(`  ${"".padEnd(18)} holdout  ${fmt(r.holdout)}`);
      }
      if (windowDays === days) {
        for (const p of ["EXISTING", "QUALITY_FIRST", "EXPANDED_COVERAGE"] as const) {
          const s = missingOddsSensitivity(selectByPolicy(w, p, tier));
          console.log(`  missing-odds sensitivity ${p}: unpriced ${s.unpriced}; ROI excl. ${s.roiExcludedPct?.toFixed(1) ?? "—"}%, unpriced-as-loss ${s.roiUnpricedAsLossPct?.toFixed(1) ?? "—"}%`);
        }
      }
    }
  }

  // Expanded coverage, outside the paid scope only: the minor-league question.
  const outside = selectByPolicy(rows, "EXPANDED_COVERAGE", "VIP").filter((r) => !r.inPaidScope);
  const byT: Record<string, ValidationRow[]> = {};
  for (const r of outside) (byT[generationTierOf(r.leagueApiId) ?? "UNCATALOGUED"] ??= []).push(r);
  console.log("\n== Picks outside paid scope that clear the VIP quality bars, by tier ==");
  for (const [t, list] of Object.entries(byT)) {
    const { results } = comparePolicies(list.map((r) => ({ ...r, categories: [...r.categories, "VIP"] })), "VIP");
    console.log(`  ${t.padEnd(13)} ${fmt(results[0].all)}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
