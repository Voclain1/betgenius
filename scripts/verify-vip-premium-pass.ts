/**
 * Verifies the dedicated VIP/PREMIUM pass against REAL fixtures.
 *
 * Two modes, because the expensive half should never run by accident:
 *
 *   (default)  DRY. Reports the targeting funnel exactly as the route would
 *              compute it, plus the recorded history of every past run. Costs
 *              nothing: no model calls, no api-football calls, no writes.
 *
 *   --live     Runs the pass for real — generation over the market-selected
 *              targets, then the gate — and reports what it promoted. Spends
 *              model calls and whatever api-football quota a cold context
 *              needs, and writes PENDING_REVIEW rows exactly as the scheduler
 *              would. Bounded by the daily quota like any other run.
 *
 * The numbers this exists to answer, both against forecasts that were made
 * BEFORE any of it was built, so they can be wrong:
 *
 *   - promotion rate against the modelled 1.65 VIP picks/day and 1.00
 *     PREMIUM picks/day;
 *   - whether MODEL_BELOW_FLOOR is still the dominant rejection. It was 60.7%
 *     on the untargeted predecessor. Market-first targeting is supposed to fix
 *     that by handing the model only fixtures the market already calls
 *     one-sided. If it is still dominant, targeting did not work and the quota
 *     is buying drafts that were never going to qualify.
 *
 * Run: npx tsx --env-file=.env scripts/verify-vip-premium-pass.ts [--live] [days]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import {
  selectVipPremiumTargets,
  vipPremiumQuotaRemaining,
  applyVipPremiumGate,
  VIP_PREMIUM_INTENT,
  VIP_PREMIUM_DAILY_QUOTA,
  VIP_MARKET_FLOOR,
  PREMIUM_MARKET_FLOOR,
} from "../src/lib/vipPremiumPipeline";
import { VIP_GENERATED_PROVENANCE, PREMIUM_GENERATED_PROVENANCE } from "../src/lib/geniusCuration";

/** The forecasts this run is grading itself against — made before the build. */
const FORECAST_VIP_PER_DAY = 1.65;
const FORECAST_PREMIUM_PER_DAY = 1.0;
/** The predecessor's dominant rejection, the regression this pass must not reproduce. */
const PREDECESSOR_MODEL_BELOW_FLOOR = 0.607;

const LIVE = process.argv.includes("--live");
/**
 * Drops the top-12 league restriction. Exists because a fixture stays claimable
 * for a median of only 23 minutes before ordinary generation takes it, so an
 * in-scope PENDING candidate is frequently unavailable on demand — and "we
 * could not run it today" is not a verification. Production never sets this.
 */
const ANY_LEAGUE = process.argv.includes("--any-league");
const DAYS = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 14);
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

function intentOf(promptJson: string): string | null {
  try {
    return JSON.parse(promptJson)?.intent ?? null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`\n=== Dedicated VIP/PREMIUM pass — verification (${LIVE ? "LIVE" : "dry"}) ===\n`);

  // ---- targeting funnel, as the route computes it ------------------------
  const remaining = await vipPremiumQuotaRemaining();
  // Warm only on a live run: the dry mode must stay free of api-football spend.
  const selection = await selectVipPremiumTargets(
    new Date(),
    Math.min(remaining || VIP_PREMIUM_DAILY_QUOTA, 12),
    { warmOdds: LIVE, anyLeague: ANY_LEAGUE },
  );
  console.log(`--- Targeting funnel (right now) ---`);
  console.log(`  quota ${VIP_PREMIUM_DAILY_QUOTA}/day, remaining today: ${remaining}`);
  console.log(`  un-generated fixtures in the odds horizon: ${selection.considered}`);
  console.log(`  ...claimable, in window${ANY_LEAGUE ? ", ANY league" : ", paid-tier leagues"}: ${String(selection.inScope).padStart(3)}`);
  console.log(`  ...this run priced itself just now:         ${selection.warmed}`);
  console.log(`  ...carrying a quote fresh enough to read:  ${selection.freshlyPriced}`);
  console.log(`  ...the market already prices >= ${VIP_MARKET_FLOOR}:       ${selection.qualified}`);
  console.log(`  targets this run would take:               ${selection.targets.length}`);
  for (const t of selection.targets) {
    console.log(
      `      ${t.marketProbability.toFixed(1).padStart(5)}%  ${t.market} / ${t.selection}  ` +
        `${t.bookmakers} books, quote ${Math.round(t.quoteAgeMs / 60000)}m old  —  ${t.homeTeam} v ${t.awayTeam}`,
    );
  }
  if (selection.targets.length === 0) {
    console.log(`  (an empty target list is a NORMAL outcome — curation fills the tiers regardless)`);
  }

  // ---- live run ----------------------------------------------------------
  if (LIVE) {
    if (selection.targets.length === 0) {
      console.log(`\n--- Live run skipped: nothing qualified, so there is nothing to generate ---`);
    } else if (remaining <= 0) {
      console.log(`\n--- Live run skipped: daily quota already spent ---`);
    } else {
      const { runGeneration } = await import("../src/lib/generation/worker");
      const author = await prisma.user.findFirst({
        where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!author) throw new Error("no admin user to attribute generated predictions to");

      console.log(`\n--- Live run: generating over ${selection.targets.length} market-selected target(s) ---`);
      const report = await runGeneration({
        authorId: author.id,
        intent: VIP_PREMIUM_INTENT,
        categories: ["FEATURED"],
        matchKeys: selection.targets.map((t) => t.matchKey),
        limit: Math.min(remaining, selection.targets.length),
      });
      console.log(`  claimed ${report.claimed}, succeeded ${report.succeeded}, failed ${report.failed}, predictions ${report.predictionsCreated}`);

      const gate = await applyVipPremiumGate();
      console.log(`  gate: evaluated ${gate.evaluated} draft(s) across ${gate.fixtures} fixture(s)`);
      for (const p of [...gate.promotedPremium, ...gate.promotedVip]) {
        console.log(
          `      PROMOTED ${p.tier}  ${p.fixture} — ${p.pick}  ` +
            `model ${p.verdict.modelProbability}% vs market ${p.verdict.marketProbability?.toFixed(1)}% ` +
            `(gap ${p.verdict.gapPP?.toFixed(1)}pp, ${p.verdict.bookmakers} books)`,
        );
      }
      const reasons = gate.rejected.reduce<Record<string, number>>((acc, r) => {
        const k = r.verdict.reason ?? "?";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});
      for (const [k, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
        console.log(`      rejected ${k}: ${n}`);
      }
    }
  }

  // ---- recorded history, across however many days have run ---------------
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: since } },
    select: { prompt: true, createdAt: true },
  });
  const mineJobs = jobs.filter((j) => intentOf(j.prompt) === VIP_PREMIUM_INTENT);
  const activeDays = new Set(mineJobs.map((j) => j.createdAt.toISOString().slice(0, 10)));

  const promoted = await prisma.prediction.findMany({
    where: {
      createdAt: { gte: since },
      provenance: { in: [VIP_GENERATED_PROVENANCE, PREMIUM_GENERATED_PROVENANCE] },
    },
    select: { provenance: true, confidence: true, outcome: true, marketType: true, createdAt: true },
  });
  const vipCount = promoted.filter((p) => p.provenance === VIP_GENERATED_PROVENANCE).length;
  const premCount = promoted.filter((p) => p.provenance === PREMIUM_GENERATED_PROVENANCE).length;

  console.log(`\n--- Recorded history, last ${DAYS} days ---`);
  console.log(`  attempts (AIJobs with ${VIP_PREMIUM_INTENT} intent): ${mineJobs.length} on ${activeDays.size} distinct day(s)`);
  if (activeDays.size === 0) {
    console.log(`  no run has executed yet — re-run with --live on several real days before reading anything into the rates below.`);
  }
  const d = Math.max(1, activeDays.size);
  console.log(`  promoted VIP_GENERATED:     ${vipCount}  (${(vipCount / d).toFixed(2)}/active day vs forecast ${FORECAST_VIP_PER_DAY})`);
  console.log(`  promoted PREMIUM_GENERATED: ${premCount}  (${(premCount / d).toFixed(2)}/active day vs forecast ${FORECAST_PREMIUM_PER_DAY})`);
  console.log(`  promotion rate per attempt: ${pct(vipCount + premCount, mineJobs.length)}`);

  // ---- the regression check ----------------------------------------------
  // Re-derives the rejection mix over every draft this pass has ever produced,
  // rather than only the ones in the run above, so the comparison against the
  // predecessor's 60.7% strengthens as days accumulate.
  const drafts = await prisma.prediction.findMany({
    where: { createdAt: { gte: since }, aiJobId: { not: null } },
    select: { confidence: true, aiJob: { select: { prompt: true } } },
  });
  const mineDrafts = drafts.filter((r) => r.aiJob && intentOf(r.aiJob.prompt) === VIP_PREMIUM_INTENT);
  const belowFloor = mineDrafts.filter((r) => r.confidence < 75).length;

  console.log(`\n--- Regression check: did targeting fix MODEL_BELOW_FLOOR? ---`);
  console.log(`  drafts produced by this pass: ${mineDrafts.length}`);
  console.log(`  below the model floor of 75:  ${belowFloor}  ${pct(belowFloor, mineDrafts.length)}`);
  console.log(`  predecessor (untargeted):     ${(PREDECESSOR_MODEL_BELOW_FLOOR * 100).toFixed(1)}%`);
  if (mineDrafts.length === 0) {
    console.log(`  VERDICT: no drafts yet — not answerable.`);
  } else if (mineDrafts.length < 20) {
    console.log(`  VERDICT: ${mineDrafts.length} drafts is too few to call. Keep running.`);
  } else if (belowFloor / mineDrafts.length < PREDECESSOR_MODEL_BELOW_FLOOR / 2) {
    console.log(`  VERDICT: targeting materially reduced it.`);
  } else {
    console.log(`  VERDICT: STILL DOMINANT — targeting is not doing its job; do not raise the quota.`);
  }

  console.log(`\n  tiers: VIP market floor ${VIP_MARKET_FLOOR}, PREMIUM market floor ${PREMIUM_MARKET_FLOOR}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
