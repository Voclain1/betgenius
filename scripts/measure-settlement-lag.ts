/**
 * How long a published pick waits for its result. READ-ONLY, no provider calls.
 * Run: npx tsx scripts/measure-settlement-lag.ts
 */
export {};
import { prisma } from "../src/lib/prisma";

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
  }
  const since = new Date(Date.now() - 72 * 3600_000);
  const runs = await prisma.jobRun.findMany({ where: { job: "settle", ranAt: { gte: since } }, orderBy: { ranAt: "asc" } });
  console.log(`settle runs, last 72h: ${runs.length}`);
  for (const r of runs) console.log(`  ${r.ranAt.toISOString().slice(0, 16)} ok=${r.ok} ${r.ms ?? "?"}ms ${r.summary ?? ""}`);

  const rows = await prisma.prediction.findMany({
    where: { settledAt: { gte: new Date(Date.now() - 7 * 86400_000) }, settledById: null, kickoff: { not: null }, outcome: { not: "PENDING" } },
    select: { kickoff: true, settledAt: true, leagueApiId: true },
  });
  const lags = rows.map((r) => (r.settledAt!.getTime() - r.kickoff!.getTime()) / 3600_000).sort((a, b) => a - b);
  const q = (p: number) => lags.length ? lags[Math.min(lags.length - 1, Math.floor(p * lags.length))].toFixed(1) : "-";
  console.log(`\nauto-settled last 7d: ${lags.length}; hours from kickoff to result p10 ${q(0.1)} p50 ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)} max ${q(0.999)}`);
  const buckets = [3, 4, 6, 9, 12, 24, 48];
  for (const b of buckets) console.log(`  within ${b}h: ${lags.filter((l) => l <= b).length}`);

  const pending = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", outcome: "PENDING", kickoff: { lt: new Date(Date.now() - 2 * 3600_000) } },
    select: { kickoff: true, manualSettlementOnly: true, settlementAttempts: true, homeTeam: true, awayTeam: true },
    orderBy: { kickoff: "asc" },
  });
  console.log(`\npublished, still PENDING, kickoff >2h ago: ${pending.length} (manual-only ${pending.filter((p) => p.manualSettlementOnly).length})`);
  for (const p of pending.slice(0, 15)) console.log(`  ${p.kickoff!.toISOString().slice(0, 16)} attempts ${p.settlementAttempts} manual=${p.manualSettlementOnly} ${p.homeTeam} v ${p.awayTeam}`);
  const jobs = await prisma.jobRun.groupBy({ by: ["job"], where: { ranAt: { gte: new Date(Date.now() - 24 * 3600_000) } }, _count: true, _max: { ranAt: true, ms: true } });
  console.log("\nall jobs, last 24h:");
  for (const j of jobs) console.log(`  ${j.job}: ${j._count} runs, last ${j._max.ranAt?.toISOString().slice(0, 16)}, max ${j._max.ms}ms`);
  console.log(`\nnow ${new Date().toISOString()}`);
}
main().finally(() => prisma.$disconnect());
