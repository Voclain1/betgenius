/**
 * MEASUREMENT INFRASTRUCTURE — not the production schedule.
 *
 * Fires the dedicated VIP/PREMIUM pass whenever a claimable window opens, so
 * that real attempt and promotion numbers accumulate against the forecasts
 * (1.65 VIP picks/day, 1.00 PREMIUM picks/day) and against the predecessor's
 * 60.7% MODEL_BELOW_FLOOR rate.
 *
 * WHY A POLLER EXISTS AT ALL. Targeting can only select fixtures the worker can
 * still claim, and a fixture stays PENDING for a median of 23 minutes (p10 8,
 * p90 113) before ordinary generation takes it. Measured on this database,
 * every in-scope fixture in the next 72 hours was already SUCCEEDED, so an
 * on-demand run finds nothing. The permanent answer is cron ordering — this
 * pass running immediately ahead of ordinary generation, which gives it first
 * claim. Until that ordering is in place, polling is the only way to be present
 * when a window happens to be open.
 *
 * SAFETY. Every tick respects the ordinary daily quota, so this cannot generate
 * more than the pass itself would. Nothing is published: drafts land
 * PENDING_REVIEW exactly as the scheduler's would. It stops on its own at
 * --max-hours so an unattended run cannot poll indefinitely. A tick that throws
 * — a suspended Neon instance, a provider timeout — is logged and backed off,
 * never fatal.
 *
 * Run: npx tsx --env-file=.env scripts/poll-vip-premium-window.ts [--every 5] [--max-hours 12] [--dry]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import type { prisma as PrismaClient } from "../src/lib/prisma";

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

const EVERY_MIN = Math.max(1, arg("every", 5));
const MAX_HOURS = Math.max(0.1, arg("max-hours", 12));
const DRY = process.argv.includes("--dry");

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { prisma } = (await import("../src/lib/prisma")) as { prisma: typeof PrismaClient };
  const {
    selectVipPremiumTargets,
    vipPremiumQuotaRemaining,
    applyVipPremiumGate,
    VIP_PREMIUM_INTENT,
    VIP_PREMIUM_DAILY_QUOTA,
  } = await import("../src/lib/vipPremiumPipeline");
  const { runGeneration } = await import("../src/lib/generation/worker");

  const author = await prisma.user.findFirst({
    where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!author) throw new Error("no admin user to attribute generated predictions to");

  const deadline = Date.now() + MAX_HOURS * 3_600_000;
  console.log(
    `[${stamp()}] polling every ${EVERY_MIN}m for up to ${MAX_HOURS}h${DRY ? " (DRY: will not generate)" : ""}; ` +
      `quota ${VIP_PREMIUM_DAILY_QUOTA}/day`,
  );

  let ticks = 0;
  let firedRuns = 0;
  let totalAttempts = 0;
  let totalVip = 0;
  let totalPremium = 0;

  /**
   * Consecutive ticks that threw, for the backoff below.
   *
   * THIS LOOP MUST SURVIVE A TRANSIENT DATABASE ERROR. The first version wrapped
   * only the generation call, so when Neon dropped the connection during the
   * quota read — serverless instances suspend, and P1001 is a normal event, not
   * a bug — the whole poll died at tick 13 after 56 minutes of clean ticks. A
   * multi-day measurement run that a single blip can end is not measurement
   * infrastructure.
   */
  let consecutiveErrors = 0;

  while (Date.now() < deadline) {
    ticks++;
    try {
      const remaining = await vipPremiumQuotaRemaining();
      // Reset here, not at the end of the tick: the no-window and quota-spent
      // paths below both `continue`, so an end-of-tick reset would never run on
      // the overwhelmingly common tick and the backoff would ratchet up forever
      // after a single blip.
      consecutiveErrors = 0;

      if (remaining <= 0) {
        console.log(`[${stamp()}] tick ${ticks}: quota spent for today — idling`);
        await sleep(EVERY_MIN * 60_000);
        continue;
      }

      // Warm only when there is quota to act on: warming costs one api-football
      // call per fixture, and spending it on a tick that cannot generate would
      // burn budget to learn nothing.
      const selection = await selectVipPremiumTargets(new Date(), Math.min(remaining, 6), { warmOdds: true });

      if (selection.targets.length === 0) {
        console.log(
          `[${stamp()}] tick ${ticks}: no window — ` +
            `${selection.considered} candidates, ${selection.inScope} claimable in-scope, ` +
            `${selection.warmed} priced, ${selection.qualified} above the bar`,
        );
        await sleep(EVERY_MIN * 60_000);
        continue;
      }

      console.log(
        `[${stamp()}] tick ${ticks}: WINDOW OPEN — ${selection.inScope} claimable, ` +
          `${selection.qualified} above the bar, taking ${selection.targets.length}`,
      );
      for (const t of selection.targets) {
        console.log(`    ${t.marketProbability.toFixed(1)}% ${t.market}/${t.selection} (${t.bookmakers} books)  ${t.homeTeam} v ${t.awayTeam}`);
      }

      if (DRY) {
        console.log(`    (dry run — not generating)`);
        await sleep(EVERY_MIN * 60_000);
        continue;
      }

      try {
        const report = await runGeneration({
          authorId: author.id,
          intent: VIP_PREMIUM_INTENT,
          categories: ["FEATURED"],
          matchKeys: selection.targets.map((t) => t.matchKey),
          limit: Math.min(remaining, selection.targets.length),
        });
        firedRuns++;
        totalAttempts += report.succeeded;
        console.log(
          `    generation: claimed ${report.claimed}, succeeded ${report.succeeded}, ` +
            `failed ${report.failed}, predictions ${report.predictionsCreated}`,
        );

        const gate = await applyVipPremiumGate();
        totalVip += gate.promotedVip.length;
        totalPremium += gate.promotedPremium.length;
        console.log(`    gate: ${gate.evaluated} draft(s), +${gate.promotedVip.length} VIP, +${gate.promotedPremium.length} PREMIUM`);
        for (const p of [...gate.promotedPremium, ...gate.promotedVip]) {
          console.log(
            `      PROMOTED ${p.tier}  ${p.fixture} — ${p.pick}  ` +
              `model ${p.verdict.modelProbability}% vs market ${p.verdict.marketProbability?.toFixed(1)}%`,
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
      } catch (e) {
        // A failed generation run is data too — it must not end the poll.
        console.log(`    ERROR during run: ${e instanceof Error ? e.message : String(e)}`);
      }

      await sleep(EVERY_MIN * 60_000);
    } catch (e) {
      // Anything else in the tick — a dropped connection on the quota read, a
      // provider timeout while warming odds. Log it, back off, keep polling.
      consecutiveErrors++;
      const backoffMin = Math.min(EVERY_MIN * consecutiveErrors, 30);
      console.log(
        `[${stamp()}] tick ${ticks}: TICK FAILED (${consecutiveErrors} in a row) — ` +
          `${e instanceof Error ? e.message.split("\n")[0] : String(e)}; retrying in ${backoffMin}m`,
      );
      await sleep(backoffMin * 60_000);
    }
  }

  console.log(
    `\n[${stamp()}] poll finished: ${ticks} tick(s), ${firedRuns} run(s) fired, ` +
      `${totalAttempts} attempt(s), +${totalVip} VIP, +${totalPremium} PREMIUM`,
  );
  console.log(`Read the accumulated numbers with: npx tsx --env-file=.env scripts/verify-vip-premium-pass.ts`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
