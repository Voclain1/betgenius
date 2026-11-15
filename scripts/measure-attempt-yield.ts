/**
 * VIP/Premium supply reliability: what each dedicated-pass attempt yields, by
 * the strength of the market signal that targeted it. READ-ONLY.
 *
 * VIP_PREMIUM_RUN_LIMIT is 1, so a pass run with a target attempts exactly one
 * fixture, and that run's own gate result (promotedVip/promotedPremium,
 * rejectedReasons) belongs to it. Every figure here is what the run recorded
 * at the time (JobRun detail), not a reconstruction.
 *
 * Run: REQUIRE_READ_ONLY=1 npx tsx scripts/measure-attempt-yield.ts [days=30]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import { JOB_GENERATE_VIP_PREMIUM } from "../src/lib/jobRuns";
import { PAID_MAX_MARKET_PROBABILITY } from "../src/lib/vipPremiumOverlay";
import { signalBand, summariseAttemptYield, type AttemptRecord } from "../src/lib/supplyFunnel";

async function main() {
  if (process.env.REQUIRE_READ_ONLY !== "1") throw new Error("refusing: REQUIRE_READ_ONLY=1 is required");
  const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
  if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
  const days = Math.min(60, Math.max(7, Number(process.argv[2]) || 30));
  const since = new Date(Date.now() - days * 86_400_000);
  const runs = await prisma.jobRun.findMany({ where: { job: JOB_GENERATE_VIP_PREMIUM, ranAt: { gte: since } }, select: { ranAt: true, detail: true }, orderBy: { ranAt: "asc" } });
  console.log(`session verified read-only; pass runs since ${since.toISOString().slice(0, 10)}: ${runs.length}; sellable ceiling ${PAID_MAX_MARKET_PROBABILITY.toFixed(2)}%`);

  const attempts: AttemptRecord[] = [];
  let multi = 0;
  for (const r of runs) {
    const v = (r.detail as any)?.vipPremium;
    const targets = (v?.targets ?? []) as Array<{ fixture: string; kickoff: string; market: string; selection: string; marketProbability: number }>;
    if (!targets.length) continue;
    if (targets.length > 1) { multi++; continue; } // gate result cannot be attributed to one target
    const t = targets[0];
    attempts.push({
      ranAt: r.ranAt, fixture: t.fixture, kickoffDay: lagosDateKey(new Date(t.kickoff)), signal: t.marketProbability, market: `${t.market} ${t.selection}`,
      promotedVip: (v.promotedVip ?? []).length, promotedPremium: (v.promotedPremium ?? []).length,
      rejected: (v.rejectedReasons ?? {}) as Record<string, number>, evaluated: v.evaluated ?? 0,
    });
  }
  console.log(`attributable single-target runs ${attempts.length}; multi-target runs skipped ${multi}`);

  const y = summariseAttemptYield(attempts, PAID_MAX_MARKET_PROBABILITY);
  console.log("\nband            attempts  promoted (VIP/PREM)  yield   rejection reasons (drafts)");
  for (const b of y.bands) console.log(`${b.band.padEnd(15)} ${String(b.attempts).padStart(8)}  ${String(b.promoted).padStart(8)} (${b.vip}/${b.premium})${" ".repeat(6)}${(b.attempts ? (100 * b.promoted / b.attempts).toFixed(0) + "%" : "—").padStart(5)}   ${JSON.stringify(b.rejected)}`);
  console.log(`\nabove the sellable ceiling: ${y.aboveCeiling.attempts} attempts, ${y.aboveCeiling.promoted} promoted; promoted picks' markets: ${JSON.stringify(y.aboveCeiling.promotedMarkets)}`);

  // Days on which the attempt quota was spent: how much of it went above the ceiling.
  const byDay = new Map<string, AttemptRecord[]>();
  for (const a of attempts) (byDay.get(a.kickoffDay) ?? byDay.set(a.kickoffDay, []).get(a.kickoffDay)!).push(a);
  console.log("\nkickoff day   attempts  above ceiling  promoted-above  promoted-within");
  for (const [d, xs] of [...byDay.entries()].sort()) {
    const above = xs.filter((a) => signalBand(a.signal, PAID_MAX_MARKET_PROBABILITY) === "above ceiling");
    console.log(`${d}  ${String(xs.length).padStart(8)}  ${String(above.length).padStart(13)}  ${String(above.reduce((s, a) => s + a.promotedVip + a.promotedPremium, 0)).padStart(14)}  ${String(xs.filter((a) => !above.includes(a)).reduce((s, a) => s + a.promotedVip + a.promotedPremium, 0)).padStart(15)}`);
  }
  console.log("\nevery attempt above the ceiling:");
  for (const a of attempts.filter((x) => signalBand(x.signal, PAID_MAX_MARKET_PROBABILITY) === "above ceiling")) {
    console.log(`  ${a.ranAt.toISOString().slice(0, 16)} ${a.kickoffDay} ${a.fixture.slice(0, 40).padEnd(40)} ${a.market.padEnd(24)} ${a.signal.toFixed(1)} -> promoted ${a.promotedVip + a.promotedPremium} rejected ${JSON.stringify(a.rejected)}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
