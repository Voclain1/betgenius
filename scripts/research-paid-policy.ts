/**
 * VIP / PREMIUM policy research (Sprint 05 continuation).
 *
 *   1. Split settled history into dev-train / dev-validate / final holdout
 *      (50 / 20 / 30 %, chronological, kickoff-grouped).
 *   2. Diagnose, on the DEVELOPMENT period only, why the first quality filter
 *      underperformed: overlap decomposition, odds and market bands,
 *      confidence calibration, competition tier, missing prices, clustering,
 *      VIP vs PREMIUM.
 *   3. Evaluate the pre-registered hypotheses on dev-train and dev-validate,
 *      and apply the fixed promotion rule.
 *   4. Score only the promoted hypotheses on the final holdout, once, next to
 *      the baseline. Report the verdict; a negative result is reported as one.
 *
 * Returns are at the last pre-kickoff quote: a CLOSING REFERENCE, not a
 * subscriber entry price and not a realized return.
 *
 * READ-ONLY. Run: npx tsx --env-file=.env scripts/research-paid-policy.ts [days=150]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { generationTierOf } from "../src/lib/leagues";
import { loadValidationRows } from "./lib/loadValidationRows";
import { selectByPolicy, windowStats, type PolicyWindow, type ValidationRow } from "../src/lib/paidPolicyValidation";
import {
  threeWaySplit, overlapDecomposition, byOddsBand, byMarketBand, byConfidenceBand, byKey, calibration, clusterEffect,
  evaluateOnDevelopment, scoreOnHoldout, PROMOTION, type Segment,
} from "../src/lib/paidPolicyResearch";

const pct = (x: number | null, d = 1) => (x == null ? "—" : `${(100 * x).toFixed(d)}%`);
const fmt = (w: PolicyWindow) =>
  `n ${String(w.n).padStart(4)} win ${pct(w.winRate)} [${w.wilson95 ? w.wilson95.map((x) => pct(x)).join("–") : "—"}] priced ${w.priced}`
  + ` closing-ref ROI ${w.roiPct == null ? "n<30" : `${w.roiPct.toFixed(1)}%`} odds ${w.meanOdds?.toFixed(2) ?? "—"} vsMkt ${w.winsOverMarket?.toFixed(1) ?? "—"}`
  + ` topLeague ${pct(w.topLeagueShare, 0)} max/day ${w.maxPerDay}`;
const show = (title: string, segs: Segment[]) => { console.log(`  ${title}`); for (const s of segs) console.log(`    ${s.key.padEnd(46)} ${fmt(s.stats)}`); };

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
    console.log("session verified read-only (transaction_read_only = on)");
  }
  const days = Math.min(365, Math.max(30, Number(process.argv[2]) || 150));
  const now = new Date();
  const { rows, postKickoff } = await loadValidationRows(new Date(now.getTime() - days * 86_400_000), now);
  const split = threeWaySplit(rows);
  console.log(`universe ${rows.length} settled singles (${days}d); post-kickoff quotes discarded ${postKickoff}`);
  console.log(`periods: dev-train ${split.devTrain.length} | dev-validate ${split.devValidate.length} (from ${split.boundaries[0]?.slice(0, 16)}) | FINAL HOLDOUT ${split.holdout.length} (from ${split.boundaries[1]?.slice(0, 16)}, untouched until step 4)`);
  console.log("returns: last pre-kickoff quote (closing reference), flat 1 unit; NOT entry prices, NOT realized returns");

  const dev = [...split.devTrain, ...split.devValidate];
  for (const tier of ["VIP", "PREMIUM"] as const) {
    const base = selectByPolicy(dev, "EXISTING", tier);
    console.log(`\n==== ${tier}: diagnosis on the development period (${base.length} existing picks) ====`);
    show("first quality filter vs existing (overlap)", overlapDecomposition(dev, tier));
    show("existing picks by odds band", byOddsBand(base));
    show("existing picks by market-probability band", byMarketBand(base));
    show("existing picks by confidence band", byConfidenceBand(base));
    const cal = calibration(base);
    console.log("  calibration (stated vs realized, decided picks):");
    for (const b of cal.bands) console.log(`    ${b.band.padEnd(8)} n ${String(b.n).padStart(4)} stated ${pct(b.stated)} realized ${pct(b.realized)} gap ${b.gap == null ? "—" : `${(100 * b.gap).toFixed(1)}pp`}`);
    console.log(`    Brier on ${cal.brierN} priced decided: model ${cal.brierModel?.toFixed(4) ?? "—"} vs market ${cal.brierMarket?.toFixed(4) ?? "—"} (lower is better)`);
    show("existing picks by generation tier", byKey(base, (r) => generationTierOf(r.leagueApiId) ?? "UNCATALOGUED"));
    show("existing picks by market type (n >= 15)", byKey(base, (r) => r.marketType, 15));
    show("existing picks by price evidence", byKey(base, (r) => r.priceSource));
    show("existing picks by league-slot clustering", clusterEffect(base));
    if (tier === "PREMIUM") {
      const vip = new Set(selectByPolicy(dev, "EXISTING", "VIP").map((r) => r.id));
      show("PREMIUM vs VIP overlap", byKey(base, (r) => (vip.has(r.id) ? "also VIP" : "PREMIUM only")));
    }

    console.log(`\n==== ${tier}: pre-registered hypotheses on development data (promotion rule: dev-validate n >= ${PROMOTION.MIN_N}, keeps >= ${100 * PROMOTION.MIN_RETAINED_SHARE}% of picks, win rate >= baseline, ROI gain >= ${PROMOTION.MIN_ROI_GAIN_PP}pp, dev-train gain > 0) ====`);
    const results = evaluateOnDevelopment(selectByPolicy(split.devTrain, "EXISTING", tier), selectByPolicy(split.devValidate, "EXISTING", tier));
    const bt = results[0]?.devTrain.baseline, bv = results[0]?.devValidate.baseline;
    if (bt && bv) { console.log(`  BASELINE      dev-train    ${fmt(bt)}`); console.log(`  BASELINE      dev-validate ${fmt(bv)}`); }
    for (const r of results) {
      console.log(`  ${r.name}: ${r.rationale}`);
      console.log(`      dev-train    ${fmt(r.devTrain.hypothesis)}`);
      console.log(`      dev-validate ${fmt(r.devValidate.hypothesis)}`);
      console.log(`      ${r.promoted ? "PROMOTED to final holdout" : "not promoted"}: ${r.promotionReasons.join("; ")}`);
    }

    const promoted = results.filter((r) => r.promoted);
    console.log(`\n==== ${tier}: FINAL HOLDOUT (evaluated once; ${promoted.length} promoted hypothesis${promoted.length === 1 ? "" : "es"}) ====`);
    const baseHoldout = selectByPolicy(split.holdout, "EXISTING", tier);
    console.log(`  BASELINE (existing selection) ${fmt(windowStats(baseHoldout))}`);
    if (!promoted.length) console.log("  No hypothesis met the promotion rule on development data: none is scored on the holdout. Result: retain the existing selection.");
    for (const p of promoted) {
      const v = scoreOnHoldout(p.name, baseHoldout);
      console.log(`  ${p.name}: ${fmt(v.hypothesis)}`);
      console.log(`      removed picks: ${fmt(v.removed)}`);
      console.log(`      VERDICT ${v.verdict}: ${v.reasons.join("; ")}`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
