/**
 * Print the execution history of a scheduled job.
 *
 * The read side of JobRun. A script rather than an admin page on purpose: the
 * question this answers — "did the cron actually fire, and what did it decide"
 * — is asked while investigating, not while browsing, and a page would be more
 * surface to maintain than the problem warrants. If it ever needs to be visible
 * to someone without a terminal, the query is four lines and lives in
 * src/lib/jobRuns.ts already.
 *
 * Run: npx tsx --env-file=.env scripts/job-runs.ts [job] [limit] [--detail]
 *   npx tsx --env-file=.env scripts/job-runs.ts
 *   npx tsx --env-file=.env scripts/job-runs.ts curate-accumulators 30 --detail
 */
export {};

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

(async () => {
  const args = process.argv.slice(2).filter((a) => a !== "--detail");
  const showDetail = process.argv.includes("--detail");
  const job = args[0] ?? "curate-accumulators";
  const limit = Number(args[1] ?? 30);

  const runs = await prisma.jobRun.findMany({
    where: { job },
    orderBy: { ranAt: "desc" },
    take: limit,
    select: { ranAt: true, ok: true, summary: true, ms: true, detail: true },
  });

  if (runs.length === 0) {
    // Distinguish "this job has never recorded" from "this job has no history
    // under that name" — a typo in the job name looks identical otherwise.
    const known = await prisma.jobRun.groupBy({ by: ["job"], _count: { job: true } });
    console.log(`No runs recorded for "${job}".`);
    if (known.length) {
      console.log("Jobs that do have history:");
      for (const k of known) console.log(`  ${k.job}  (${k._count.job} runs)`);
    } else {
      console.log("No job has recorded a run yet.");
    }
    await prisma.$disconnect();
    return;
  }

  console.log(`${runs.length} most recent run(s) of "${job}", newest first:\n`);
  for (const r of runs) {
    const flag = r.ok ? "ok  " : "FAIL";
    const dur = r.ms != null ? `${String(r.ms).padStart(6)}ms` : "        ";
    console.log(`  ${r.ranAt.toISOString().slice(0, 16)}Z  ${flag}  ${dur}  ${r.summary ?? ""}`);
    if (showDetail && r.detail) console.log(`      ${JSON.stringify(r.detail)}`);
  }

  // A daily job should show one row per day. A gap is the signal worth seeing,
  // so it is stated rather than left to be spotted by eye.
  const days = new Set(runs.map((r) => r.ranAt.toISOString().slice(0, 10)));
  const span = runs.length > 1
    ? Math.round((runs[0].ranAt.getTime() - runs[runs.length - 1].ranAt.getTime()) / 86_400_000)
    : 0;
  console.log(`\n  ${runs.length} runs across ${days.size} distinct day(s), spanning ~${span} day(s).`);
  const failed = runs.filter((r) => !r.ok).length;
  if (failed) console.log(`  ${failed} run(s) recorded a failure.`);

  await prisma.$disconnect();
})();
