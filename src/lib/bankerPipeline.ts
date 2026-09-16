import { prisma } from "@/lib/prisma";
import { lagosTodayBounds } from "@/lib/lagosDate";

/**
 * The dedicated BANKER pass: intent, quota, accounting.
 *
 * WHY THIS FILE EXISTS. BANKER has been an accepted generation category the
 * whole time — resolveGenerationRisk routes it to the bolder, uncalibrated
 * "legacy" path, and FREE_CATEGORIES on the scheduled runner has always
 * included it. Nothing ever asked for it. An audit of all 820 AIJob rows
 * (2026-07-19 to 2026-09-02) found ZERO jobs carrying BANKER generation
 * intent, and zero carrying BET_OF_THE_DAY, which reuses the same route. So
 * the bolder path had never executed in production at all, and all 49 rows
 * wearing the BANKER tag were ordinary hedged output that confidence curation
 * had relabelled afterwards.
 *
 * Same shape as the Market-Confirmed and same-game-double passes: a small
 * daily quota, its own intent label on AIJob.prompt, additive to ordinary
 * generation and never a replacement for it. A day on which the quota goes
 * unspent is a normal day.
 *
 * Unlike Market-Confirmed there is no post-generation gate. BANKER's whole
 * proposition is the bolder prompt, and the pick it produces IS the output —
 * there is no second, independent signal to confirm it against, which is
 * exactly why getBetOfDayCalibration measures this route's honesty after the
 * fact instead.
 */

/** Label recorded on AIJob.prompt.intent — see GenerateFixtureInput.intent. */
export const BANKER_INTENT = "BANKER" as const;

/** What generation tags its output. Tagged FROM INTENT, never by later curation. */
export const BANKER_CATEGORIES = ["BANKER"] as const;

/**
 * Dedicated generation attempts per day.
 *
 * Counted as ATTEMPTS, not survivors, for the same reason Market-Confirmed is:
 * a job that produces an unusable draft has still spent api-football budget, a
 * model call and real money, and counting only successes would let a bad day
 * retry without limit.
 *
 * 3 rather than Market-Confirmed's 8. This route is the UNCALIBRATED one, and
 * its calibration is still unmeasured — getBetOfDayCalibration has never had a
 * single settled pick to read, because the route it measures had never run.
 * Starting small is what makes that measurement affordable to be wrong about;
 * BET_OF_DAY_DAILY_QUOTA is held at its own low number under the same gate,
 * and raising this one should wait on the same evidence.
 */
export const BANKER_DAILY_QUOTA = 3;

function intentOf(promptJson: string): string | null {
  try {
    return JSON.parse(promptJson)?.intent ?? null;
  } catch {
    return null;
  }
}

export async function bankerGeneratedToday(now: Date = new Date()): Promise<number> {
  const { start, end } = lagosTodayBounds(now);
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: { prompt: true },
  });
  return jobs.filter((j) => intentOf(j.prompt) === BANKER_INTENT).length;
}

export async function bankerQuotaRemaining(now: Date = new Date()): Promise<number> {
  return Math.max(0, BANKER_DAILY_QUOTA - (await bankerGeneratedToday(now)));
}
