/**
 * Durable execution history for scheduled jobs.
 *
 * The problem this solves, concretely: Vercel's Hobby plan keeps runtime logs
 * for minutes. Verifying that the 10:30 accumulator cron had actually fired was
 * only possible because that job writes Combo rows as its output — the evidence
 * was a side effect of what it happens to do, not something anyone designed.
 *
 * A job that correctly decides to do NOTHING leaves no such trace, and that is
 * exactly the case where you most need the record: "the cron never fired" and
 * "the cron fired and correctly stood down on a thin pool" look identical from
 * the outside, and they call for completely different responses.
 *
 * So this records the RUN, not the result. Generic by design — `job` names the
 * caller, so settlement, curation and anything scheduled later share one table
 * rather than each growing its own.
 */
import { prisma } from "@/lib/prisma";

/** Job identifiers. A constant so a typo cannot silently split one job's history in two. */
export const JOB_CURATE_ACCUMULATORS = "curate-accumulators" as const;
export const JOB_SETTLE = "settle" as const;
/**
 * The generation-reliability jobs.
 *
 * These exist because production scheduling lives in cron-job.org, outside this
 * repository — so "the VIP/PREMIUM pass is starving" and "the VIP/PREMIUM cron
 * was never firing" were indistinguishable from inside the app. Both produce no
 * paid picks. Only one of them is fixable by changing code, and telling them
 * apart previously meant logging into a third-party scheduler.
 */
export const JOB_GENERATE = "generate-ordinary" as const;
export const JOB_GENERATE_VIP_PREMIUM = "generate-vip-premium" as const;
export const JOB_GENERATE_BET_OF_DAY = "generate-bet-of-the-day" as const;
export const JOB_BET_OF_DAY_SELECT = "select-bet-of-the-day" as const;
export const JOB_REFRESH_ODDS = "refresh-odds" as const;
/**
 * Candidate discovery, which also decides the adaptive competition scope. Its
 * run detail carries the coverage report (mode, higher-tier count, fallback
 * selected, leagues scanned by tier, provider calls, and why the scope widened
 * or stayed narrow) that /admin/jobs shows.
 */
export const JOB_GENERATION_DISCOVERY = "generation-discovery" as const;
/**
 * The notification jobs. Same reason as above: their schedules live in
 * cron-job.org, so the run history is the only way to tell a cron that never
 * fired from one that fired and had nothing to send. Named in the plural to
 * match `notifications-dispatch`, which was already recording under that name.
 */
export const JOB_NOTIFICATIONS_DISPATCH = "notifications-dispatch" as const;
export const JOB_NOTIFICATIONS_REMINDERS = "notifications-reminders" as const;
/**
 * The Match Insights refresh. Defined here with the other job names rather than
 * in insightRefresh.ts, which re-exports it: that module pulls in the provider
 * client, and KNOWN_JOBS is read by the admin route, which has no business
 * loading api-football to render a table of job names.
 */
export const JOB_REFRESH_INSIGHTS = "refresh-insights" as const;

/** Every job this app records, for the admin view's benefit. */
export const KNOWN_JOBS = [
  JOB_GENERATION_DISCOVERY,
  JOB_REFRESH_ODDS,
  JOB_GENERATE_VIP_PREMIUM,
  JOB_GENERATE,
  JOB_GENERATE_BET_OF_DAY,
  JOB_BET_OF_DAY_SELECT,
  JOB_CURATE_ACCUMULATORS,
  JOB_SETTLE,
  JOB_REFRESH_INSIGHTS,
  JOB_NOTIFICATIONS_REMINDERS,
  JOB_NOTIFICATIONS_DISPATCH,
] as const;

export type JobRunInput = {
  job: string;
  ok?: boolean;
  summary?: string | null;
  detail?: unknown;
  ms?: number | null;
};

/**
 * Write one run record.
 *
 * NEVER throws. A telemetry write must not be able to fail the job it is
 * describing — a curation pass that published six accumulators and then died
 * recording that fact would be strictly worse than one that published six and
 * recorded nothing. Failures are logged and swallowed.
 *
 * Returns whether the record landed, so a caller that cares (a test, mostly)
 * can assert on it.
 */
export async function recordJobRun(input: JobRunInput): Promise<boolean> {
  try {
    await prisma.jobRun.create({
      data: {
        job: input.job,
        ok: input.ok ?? true,
        summary: input.summary ?? null,
        detail: (input.detail ?? undefined) as never,
        ms: input.ms ?? null,
      },
    });
    return true;
  } catch (error) {
    console.error(`[jobRuns] failed to record a run of ${input.job}:`, error);
    return false;
  }
}

/**
 * Times a job, records the outcome, and re-throws whatever it threw.
 *
 * The re-throw matters: this is a recorder, not an error handler. Swallowing
 * the failure here would turn a broken cron into a silent one, which is the
 * failure mode the table exists to expose — so a thrown job is recorded with
 * ok=false and the error message, then allowed to fail exactly as it would
 * have.
 */
export async function withJobRun<T>(
  job: string,
  run: () => Promise<T>,
  summarise: (result: T) => string,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    await recordJobRun({ job, ok: true, summary: summarise(result), detail: result, ms: Date.now() - startedAt });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordJobRun({ job, ok: false, summary: `threw: ${message.slice(0, 200)}`, ms: Date.now() - startedAt });
    throw error;
  }
}

/** Most recent runs of a job, newest first — the read side of the history. */
export async function recentJobRuns(job: string, limit = 20) {
  return prisma.jobRun.findMany({
    where: { job },
    orderBy: { ranAt: "desc" },
    take: limit,
    select: { id: true, job: true, ranAt: true, ok: true, summary: true, ms: true, detail: true },
  });
}

/**
 * Record a scheduled route's run without changing what it returns.
 *
 * WHY A WRAPPER RATHER THAN recordJobRun AT EACH EXIT. The generation route has
 * eleven return points, several of them early "quota already spent" stand-downs
 * — and those are precisely the runs worth recording, because a stand-down and
 * a cron that never fired look identical from outside. Threading a call through
 * every branch would be eleven chances to miss one; reading the response the
 * handler already produced cannot miss any.
 *
 * The response is CLONED before its body is read, so the caller still receives
 * an unconsumed stream.
 *
 * AUTH FAILURES ARE NOT RUNS. A 401/403 is someone calling the endpoint wrongly,
 * not a scheduled job executing, and recording those would bury real history
 * under noise. 5xx IS recorded, with ok=false — a job that failed is the most
 * important thing this table can tell anyone.
 */
export async function recordRouteRun(
  job: string,
  response: Response,
  startedAt: number,
  summarise: (payload: any) => string,
): Promise<void> {
  if (response.status === 401 || response.status === 403) return;
  let payload: unknown = null;
  try {
    payload = await response.clone().json();
  } catch {
    // A non-JSON body is still a run worth recording; the summary just says less.
  }
  await recordJobRun({
    job,
    ok: response.status < 400,
    summary: (() => {
      try {
        return summarise(payload);
      } catch {
        return `status ${response.status}`;
      }
    })(),
    detail: payload,
    ms: Date.now() - startedAt,
  });
}
