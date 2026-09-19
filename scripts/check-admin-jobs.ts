/**
 * Proves /api/admin/jobs reports every job this app records — including the
 * three whose schedules live in cron-job.org and which the view previously
 * omitted entirely.
 *
 * WHY THIS MATTERS. A job missing from KNOWN_JOBS is invisible on /admin/jobs,
 * and invisible reads exactly like healthy: no red row, no "never run", nothing
 * to notice. Match Insights sat empty for days behind precisely that gap — the
 * refresh job had never been scheduled, and the one page built to surface that
 * did not list it. So the assertions below are about coverage as much as about
 * shape: every recorded job appears, and the page can name each one.
 *
 * Deterministic and offline. The database, the session and the pool queries are
 * stubbed, so this asserts the route's own behaviour against a fixed history
 * rather than against whatever production has run today.
 *
 * Run: npx tsx scripts/check-admin-jobs.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failures.push(`${label}${got === undefined ? "" : `\n      got: ${JSON.stringify(String(got).slice(0, 300))}`}`);
};

// ---------------------------------------------------------------------------
// Stubs, installed before the route is imported.
// ---------------------------------------------------------------------------

function stub(request: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
}

type Run = { id: string; job: string; ranAt: Date; ok: boolean; summary: string | null; ms: number | null };

let history: Run[] = [];
let role = "SUPER_ADMIN";
const queries: Array<{ model: string; args: any }> = [];

const prismaStub = {
  jobRun: {
    findMany: (args: any) => {
      queries.push({ model: "jobRun", args });
      const wanted: string[] = args.where?.job?.in ?? [];
      const rows = history
        .filter((r) => wanted.includes(r.job))
        .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
        .slice(0, args.take ?? undefined);
      return Promise.resolve(rows);
    },
  },
  // The pool figures are not what this check is about; empty keeps them honest.
  generationAttempt: { findMany: () => Promise.resolve([]) },
  prediction: { findMany: () => Promise.resolve([]) },
  fixtureOddsCache: { findMany: () => Promise.resolve([]) },
};

stub("../src/lib/prisma", { prisma: prismaStub });
stub("next-auth", { getServerSession: () => Promise.resolve({ user: { id: "u1", role } }) });

const { KNOWN_JOBS, JOB_REFRESH_INSIGHTS, JOB_NOTIFICATIONS_DISPATCH, JOB_NOTIFICATIONS_REMINDERS } = require("../src/lib/jobRuns");

async function getJobs() {
  queries.length = 0;
  const route = require("../src/app/api/admin/jobs/route");
  const response = await route.GET();
  return { status: response.status, body: await response.json() };
}

const run = (job: string, over: Partial<Run> = {}): Run => ({
  id: `${job}-${Math.random().toString(36).slice(2)}`,
  job,
  ranAt: new Date(Date.now() - 5 * 60_000),
  ok: true,
  summary: `${job} did something`,
  ms: 1200,
  ...over,
});

/** Defensive: a job missing from the response must fail a check, not crash the run. */
const EMPTY = { job: null, lastRanAt: null, lastOk: null, lastSummary: null, lastMs: null, neverRan: null, recent: [] as any[] };
const byJob = (body: any, job: string) => body.jobs.find((j: any) => j.job === job) ?? EMPTY;

async function main() {
  // -------------------------------------------------------------------------
  // The three jobs this change is about are recorded jobs.
  // -------------------------------------------------------------------------
  check("the insights refresh is a known job", KNOWN_JOBS.includes(JOB_REFRESH_INSIGHTS), KNOWN_JOBS.join(","));
  check("kickoff reminders are a known job", KNOWN_JOBS.includes(JOB_NOTIFICATIONS_REMINDERS));
  check("notification dispatch is a known job", KNOWN_JOBS.includes(JOB_NOTIFICATIONS_DISPATCH));
  check("job names are unique", new Set(KNOWN_JOBS).size === KNOWN_JOBS.length);

  /**
   * Every job that records a run must be listed, or it is invisible on the
   * page. Derived from the source rather than from a hand-kept list here, so a
   * job added later fails this check instead of quietly going unseen.
   */
  const root = join(__dirname, "..");
  const recordingSources = [
    "src/app/api/admin/refresh-insights/route.ts",
    "src/app/api/admin/notifications/dispatch/route.ts",
    "src/app/api/admin/notifications/reminders/route.ts",
    "src/app/api/admin/settle/route.ts",
  ];
  for (const file of recordingSources) {
    const source = readFileSync(join(root, file), "utf8");
    const constants = [...source.matchAll(/JOB_[A-Z_]+/g)].map((m) => m[0]);
    const jobRunsModule = require("../src/lib/jobRuns");
    const insightModule = { JOB_REFRESH_INSIGHTS };
    const resolved = constants
      .map((name) => jobRunsModule[name] ?? (insightModule as Record<string, string>)[name])
      .filter((v): v is string => typeof v === "string");
    check(
      `${file.split("/").slice(-2).join("/")} records under a known job name`,
      resolved.length > 0 && resolved.every((job) => KNOWN_JOBS.includes(job)),
      resolved.join(",") || "no JOB_* constant found",
    );
  }

  // -------------------------------------------------------------------------
  // With history, the route reports the right name and status per job.
  // -------------------------------------------------------------------------
  const ranAt = new Date(Date.now() - 3 * 60_000);
  history = [
    run(JOB_NOTIFICATIONS_DISPATCH, { ranAt, ok: true, summary: "events 2, claimed 3, delivered 3", ms: 900 }),
    run(JOB_REFRESH_INSIGHTS, { ranAt: new Date(Date.now() - 9 * 60_000), ok: false, summary: "threw: provider timeout", ms: 4100 }),
  ];

  const { status, body } = await getJobs();
  check("an admin gets a 200", status === 200, String(status));
  check("every known job appears in the response", body.jobs.length === KNOWN_JOBS.length, `${body.jobs.length} of ${KNOWN_JOBS.length}`);
  check(
    "the response lists them by their recorded names",
    KNOWN_JOBS.every((job: string) => body.jobs.some((j: any) => j.job === job)),
    body.jobs.map((j: any) => j.job).join(","),
  );

  const dispatch = byJob(body, JOB_NOTIFICATIONS_DISPATCH);
  check("a job that ran is not reported as never run", dispatch.neverRan === false);
  check("...with its last run time", dispatch.lastRanAt != null && new Date(dispatch.lastRanAt).getTime() === ranAt.getTime(), dispatch.lastRanAt);
  check("...its success status", dispatch.lastOk === true);
  check("...and what it did", dispatch.lastSummary === "events 2, claimed 3, delivered 3", dispatch.lastSummary);
  check("...and its duration", dispatch.lastMs === 900);

  const insights = byJob(body, JOB_REFRESH_INSIGHTS);
  check("a failed run is reported as failed", insights.lastOk === false);
  check("...carrying the failure summary", insights.lastSummary === "threw: provider timeout", insights.lastSummary);

  const reminders = byJob(body, JOB_NOTIFICATIONS_REMINDERS);
  check("a job with no history is reported as never run", reminders.neverRan === true);
  check("...with nothing invented for its last run", reminders.lastRanAt === null && reminders.lastOk === null && reminders.lastSummary === null);

  check(
    "the query asks only for known jobs",
    JSON.stringify(queries.find((q) => q.model === "jobRun")?.args.where?.job?.in) === JSON.stringify([...KNOWN_JOBS]),
    JSON.stringify(queries.find((q) => q.model === "jobRun")?.args.where),
  );

  // -------------------------------------------------------------------------
  // Newest first, and the per-job history is capped.
  // -------------------------------------------------------------------------
  const newest = new Date(Date.now() - 60_000);
  history = [
    ...Array.from({ length: 12 }, (_, i) => run(JOB_REFRESH_INSIGHTS, { ranAt: new Date(Date.now() - (i + 2) * 60_000), summary: `run ${i}` })),
    run(JOB_REFRESH_INSIGHTS, { ranAt: newest, summary: "newest" }),
  ];
  const paged = byJob((await getJobs()).body, JOB_REFRESH_INSIGHTS);
  check("the most recent run is the one reported", paged.lastSummary === "newest", paged.lastSummary);
  check("the recent list is capped at 8", paged.recent.length === 8, String(paged.recent.length));
  check("the recent list is newest first", paged.recent[0]?.summary === "newest", paged.recent[0]?.summary);

  // -------------------------------------------------------------------------
  // The page can name every job it will be handed.
  // -------------------------------------------------------------------------
  const page = readFileSync(join(root, "src/app/admin/jobs/page.tsx"), "utf8");
  const labelBlock = page.slice(page.indexOf("const LABEL"), page.indexOf("function ago"));
  for (const job of KNOWN_JOBS) {
    check(`the admin page labels "${job}"`, labelBlock.includes(`"${job}"`) || labelBlock.includes(`${job}:`), labelBlock.slice(0, 200));
  }

  // -------------------------------------------------------------------------
  // Still admin-only.
  // -------------------------------------------------------------------------
  role = "USER";
  stub("next-auth", { getServerSession: () => Promise.resolve({ user: { id: "u2", role: "USER" } }) });
  delete require.cache[require.resolve("../src/app/api/admin/jobs/route")];
  const forbidden = await getJobs();
  check("a non-admin is refused", forbidden.status === 403, String(forbidden.status));

  console.log(`\n  ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  if (failures.length) process.exit(1);
  console.log("admin jobs checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
