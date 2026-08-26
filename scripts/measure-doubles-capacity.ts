/** Read-only production sizing for the regular-feed doubles quota. */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { estimateCostUsd } from "../src/lib/generation/stats";
import { getUsageSnapshot } from "../src/lib/football/usage";
import { lagosTodayBounds } from "../src/lib/lagosDate";

function categories(prompt: string): string[] {
  try {
    const value = JSON.parse(prompt)?.categories;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

type MeasuredJob = { model: string; promptTokens: number | null; outputTokens: number | null; createdAt: Date };

function summarize(label: string, jobs: MeasuredJob[]) {
  const input = jobs.reduce((sum, job) => sum + (job.promptTokens ?? 0), 0);
  const output = jobs.reduce((sum, job) => sum + (job.outputTokens ?? 0), 0);
  const cost = jobs.reduce((sum, job) => sum + estimateCostUsd(job.model, job.promptTokens ?? 0, job.outputTokens ?? 0), 0);
  console.log(`${label}: n=${jobs.length}`);
  if (jobs.length) {
    console.log(`  mean tokens: input ${Math.round(input / jobs.length)}, output ${Math.round(output / jobs.length)}`);
    console.log(`  measured model cost: $${cost.toFixed(4)} total, $${(cost / jobs.length).toFixed(4)}/fixture`);
  }
}

async function main() {
  const now = new Date();
  const since7 = new Date(now.getTime() - 7 * 86_400_000);
  const { start } = lagosTodayBounds(now);
  const [jobs, doublesByStatus, pendingReview, queued, usage] = await Promise.all([
    prisma.aIJob.findMany({
      where: { createdAt: { gte: since7 }, status: "COMPLETED" },
      select: { model: true, prompt: true, promptTokens: true, outputTokens: true, createdAt: true },
    }),
    prisma.prediction.groupBy({
      by: ["status"], where: { marketType: "SAME_GAME_DOUBLE" }, _count: true,
    }),
    prisma.prediction.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.generationAttempt.count({
      where: { kickoff: { gt: now }, OR: [{ status: "PENDING" }, { status: "FAILED", nextAttemptAt: { lte: now } }] },
    }),
    getUsageSnapshot(),
  ]);

  const multi = jobs.filter((job) => categories(job.prompt).includes("SAME_GAME_DOUBLE"));
  const single = jobs.filter((job) => !categories(job.prompt).includes("SAME_GAME_DOUBLE"));
  summarize("multi-market jobs, last 7d", multi);
  summarize("other completed jobs, last 7d", single);
  console.log(`\nexisting SAME_GAME_DOUBLE rows: ${doublesByStatus.map((row) => `${row.status}=${row._count}`).join(" ") || "none"}`);
  console.log(`pending-review rows now: ${pendingReview}`);
  console.log(`eligible queued fixtures now: ${queued}`);
  console.log(`api-football today: used ${usage.used}, remaining ${usage.remaining} of ${usage.limit} (reserve ${usage.reserve})`);
  console.log(`multi-market jobs today: ${multi.filter((job) => job.createdAt >= start).length}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
