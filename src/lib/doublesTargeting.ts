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
