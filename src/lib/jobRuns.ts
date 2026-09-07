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
