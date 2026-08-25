import { prisma } from "@/lib/prisma";
import { lagosTodayBounds } from "@/lib/lagosDate";

/**
 * A small daily allowance of multi-market generation, reserved for the Doubles
 * pipeline.
 *
 * WHY A QUOTA RATHER THAN A SWITCH. Multi-market generation works — measured
 * at 2.17 market calls per fixture against 1.00 for the production prompt —
 * but every row one job creates inherits that job's categories (see
 * generate.ts). Turning it on globally would therefore put two or three rows
 * for the SAME fixture into FEATURED, GENIUS, TODAY and every other feed,
 * changing the shape of the whole site to serve one feature. A quota buys the
 * candidates the Doubles pipeline needs while leaving those feeds exactly as
 * they are: one row per fixture.
 *
 * WHY THE ROWS DO NOT LEAK. A doubles-intent job is tagged SAME_GAME_DOUBLE
 * and nothing else, so its rows are absent from every other category by
 * construction rather than by filtering. The Doubles feed itself renders only
 * assembled doubles (see getCategoryPredictions), so the legs do not appear
 * there either — they are visible inside the double that quotes them.
 *
 * SIZE. Eight fixtures a day. At the measured assembly rate that is roughly
 * eight doubles a day, which reaches the 30-settled floor in about a week once
 * settlement lag is counted — fast enough to be worth doing, small enough that
 * a bad prompt cannot flood the review queue before anyone notices. Raising it
 * is a decision to take once the first 30 have settled and the strike rate is
 * known, not before.
 */
export const DOUBLES_DAILY_QUOTA = 8;

export const SAME_GAME_DOUBLE = "SAME_GAME_DOUBLE" as const;

/**
 * How many doubles-intent generations have run today.
 *
 * Counted from AIJob.prompt, which stores the literal categories the job was
 * launched with, rather than from the resulting Prediction rows. Rows are the
 * wrong thing to count twice over: a doubles job creates two or three of them,
 * and a job that failed created none while still having spent its slot and its
 * money. The same reasoning and the same mechanism as
 * betOfTheDayGeneratedToday.
 */
export async function doublesGeneratedToday(now: Date = new Date()): Promise<number> {
  const { start, end } = lagosTodayBounds(now);
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: { prompt: true },
  });
  return jobs.filter((j) => {
    try {
      return (JSON.parse(j.prompt)?.categories ?? []).includes(SAME_GAME_DOUBLE);
    } catch {
      // A job whose prompt is unparseable cannot be proven to be a doubles
      // job, and counting it would silently eat somebody else's slot.
      return false;
    }
  }).length;
}

/** Remaining multi-market generations allowed today. */
export async function doublesQuotaRemaining(now: Date = new Date()): Promise<number> {
  return Math.max(0, DOUBLES_DAILY_QUOTA - (await doublesGeneratedToday(now)));
}

/**
 * Whether a generation job should ask for several markets.
 *
 * Derived from the job's own intent rather than passed down through the queue,
 * for the same reason resolveGenerationRisk derives calibration from
 * categories: the caller already says what the job is FOR, and threading a
 * second parameter through every layer would let the two disagree.
 */
export function marketBreadthForCategories(categories: readonly string[]): "single" | "multi" {
  return categories.includes(SAME_GAME_DOUBLE) ? "multi" : "single";
}

/**
 * The client-side ceiling this path is scheduled against.
 *
 * cron-job.org disconnects at 30s. That is the number the budget below is
 * derived from — not Vercel's 300s function limit, which is far larger and
 * never the binding constraint here.
 */
export const DOUBLES_CLIENT_BUDGET_MS = 30_000;

/**
 * Runway one doubles fixture needs, measured rather than guessed.
 *
 * Five real end-to-end runs came in at 20.3, 23.9, 24.6, 28.3 and 29.9s. The
 * cost splits into a near-constant ~15s of throttled api-football fetches
 * (11 calls to build the digest) and a model call of 6.8-13.2s — roughly
 * double a single-market call, which is expected since the job writes two or
 * three predictions' worth of reasoning.
 *
 * 27s is the observed spread rounded UP, not an average. Budgeting to the mean
 * would guarantee overruns on exactly the slow runs the budget exists to catch.
 */
export const DOUBLES_FIXTURE_COST_MS = 27_000;

/**
 * Stop STARTING doubles fixtures once this much of the run has elapsed.
 *
 * The honest limitation: with limit=1 this can never save the FIRST fixture —
 * at zero elapsed there is always runway, so the fixture starts and takes what
 * it takes. It bounds every fixture after the first, which is what makes a
 * limit>1 run safe rather than a gamble.
 *
 * That the first fixture can still exceed 30s is deliberate and safe, because
 * the work does not stop when the client hangs up: a request aborted at 5s was
 * verified to keep running and finish its rows a minute later. A reported
 * timeout on this route is cosmetic. The lease in worker.ts is what prevents a
 * retry from starting a duplicate alongside the run still in flight.
 */
export const DOUBLES_START_CUTOFF_MS = Math.max(0, DOUBLES_CLIENT_BUDGET_MS - DOUBLES_FIXTURE_COST_MS);

/**
 * How long a run may keep claiming new fixtures, given what it is generating.
 *
 * Doubles cost roughly twice a normal fixture, so they cannot share the
 * general 22s cutoff: at 22s elapsed a doubles fixture would be started with
 * 8s of client budget left and about 27s of work to do.
 */
export function startCutoffMsForCategories(categories: readonly string[], defaultCutoffMs: number): number {
  return categories.includes(SAME_GAME_DOUBLE) ? DOUBLES_START_CUTOFF_MS : defaultCutoffMs;
}
