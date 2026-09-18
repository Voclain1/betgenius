/**
 * Is the existing dedicated Market-Confirmed pass — which already targets
 * VIP+PREMIUM — actually being INVOKED?
 *
 * It models ~1.65 qualifying picks a day and has produced 3 rows in 90. That
 * gap is either a gate that rejects nearly everything, or a pass nobody calls.
 * Those two diagnoses imply completely different proposals, so this counts the
 * attempts directly: AIJob rows by recorded intent.
 *
 * Read-only. Run: npx tsx --env-file=.env scripts/research-vip-premium-invocation.ts [days]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";

const DAYS = Number(process.argv[2] ?? 90);

async function main() {
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: since } },
    select: { prompt: true, createdAt: true },
  });
  console.log(`\n=== AIJob intent census — last ${DAYS} days (n=${jobs.length}) ===\n`);

  const byIntent = new Map<string, number>();
  const daysByIntent = new Map<string, Set<string>>();
  for (const j of jobs) {
    let intent = "(none)";
    try {
      intent = JSON.parse(j.prompt)?.intent ?? "(none)";
    } catch {
      intent = "(unparseable)";
    }
    byIntent.set(intent, (byIntent.get(intent) ?? 0) + 1);
    if (!daysByIntent.has(intent)) daysByIntent.set(intent, new Set());
    daysByIntent.get(intent)!.add(j.createdAt.toISOString().slice(0, 10));
  }
  for (const [intent, n] of [...byIntent.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${intent.padEnd(22)} ${String(n).padStart(5)} jobs on ${String(daysByIntent.get(intent)!.size).padStart(3)} distinct days`);
  }

  const runs = await prisma.jobRun.findMany({
    where: { ranAt: { gte: since } },
    select: { job: true, ranAt: true, ok: true },
  });
  const byJob = new Map<string, { n: number; ok: number }>();
  for (const r of runs) {
    const e = byJob.get(r.job) ?? { n: 0, ok: 0 };
    e.n++;
    if (r.ok) e.ok++;
    byJob.set(r.job, e);
  }
  console.log(`\n=== Recorded JobRuns (what the scheduler actually fires) ===\n`);
  if (!runs.length) console.log("  none recorded in window");
  for (const [job, e] of [...byJob.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${job.padEnd(28)} ${String(e.n).padStart(4)} runs, ${e.ok} ok`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
