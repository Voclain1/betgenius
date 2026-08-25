import { prisma } from "@/lib/prisma";
import { qualifiesForBetOfDay, impliedProbability, type FixtureOdds } from "@/lib/odds";
import { matchKey } from "@/lib/slug";
import { BET_OF_THE_DAY, BET_OF_DAY_MIN_CALIBRATION_SAMPLE, BET_OF_DAY_DAILY_QUOTA } from "@/lib/betOfTheDay";

/**
 * Standing calibration measurement for BET_OF_THE_DAY predictions.
 *
 * This is a PERMANENT signal, not a one-off pre-scaling check. The bolder
 * (uncalibrated/BANKER) prompt path had never run in production before this
 * feature existed — verified from AIJob.prompt, where every prior scheduled job
 * used FEATURED intent — so nothing was known about how its confidence numbers
 * relate to reality. That stays true of every future model change, prompt edit
 * and provider failover, which is why this lives on the admin panel rather than
 * in a script someone ran once.
 *
 * The question it answers is narrow and falsifiable: when this category says
 * 70%, do 70% of those picks actually win?
 *
 * Three figures, and the gap between them is the whole point:
 *
 *   meanConfidence  — what the model claimed, averaged over settled picks.
 *   meanImplied     — what the market's price implied at the time we cached it.
 *   actualStrikeRate— what fraction actually won.
 *
 * meanConfidence - actualStrikeRate is the OVERCONFIDENCE GAP. Positive means
 * the model claims more than it delivers. That is the number the volume gate
 * turns on.
 *
 * meanImplied is not a target to beat on average — it is context. A category
 * whose picks are priced at an implied 30% and strike at 30% is well calibrated
 * and merely has no edge; one that claims 70% and strikes at 30% is broken in a
 * different and more serious way. Reporting both keeps those apart.
 */

/** Settled outcomes that count. VOID is excluded — a voided pick tests nothing. */
const DECIDED = ["WON", "LOST"] as const;

export type CalibrationBucket = {
  label: string;
  settled: number;
  won: number;
  meanConfidence: number;
  actualStrikeRate: number;
  /** meanConfidence - actualStrikeRate, in percentage points. Positive = overconfident. */
  gapPP: number;
};

export type BetOfDayCalibration = {
  /** Settled, decided picks generated with BET_OF_THE_DAY intent. */
  settled: number;
  won: number;
  lost: number;
  /** Still awaiting a result — the pipeline in progress. */
  pending: number;
  meanConfidence: number | null;
  meanImplied: number | null;
  actualStrikeRate: number | null;
  /** The headline number: positive means confidence outruns outcomes. */
  overconfidenceGapPP: number | null;
  /**
   * Standard error on the strike rate at this sample size, in percentage
   * points — what makes the gap interpretable rather than merely large or
   * small. A gap inside ~2 SE is not yet distinguishable from noise.
   */
  standardErrorPP: number | null;
  /** True when the gap exceeds two standard errors — a real signal, not variance. */
  significant: boolean | null;
  /** Confidence bands, so a uniform bias is distinguishable from one concentrated at the top end. */
  buckets: CalibrationBucket[];
  /** Gate state for raising BET_OF_DAY_DAILY_QUOTA. */
  gate: {
    minimumSample: number;
    sampleMet: boolean;
    /** Null until the sample floor is met — the gate deliberately refuses to rule early. */
    passes: boolean | null;
    verdict: string;
  };
  quota: number;
};

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (v: number | null, dp = 1): number | null => (v == null ? null : Number(v.toFixed(dp)));

/**
 * Reads settled BET_OF_THE_DAY-intent predictions and measures them.
 *
 * Selection is by GENERATION INTENT (AIJob.prompt), not by the category tag on
 * the prediction. A tag can be added or removed by an admin at any time, and
 * measuring the bolder prompt path means measuring what was actually asked of
 * the model. Picks merely tagged into the slot afterwards were generated on the
 * calibrated path and would dilute exactly the signal this exists to find.
 */
export async function getBetOfDayCalibration(): Promise<BetOfDayCalibration> {
  const jobs = await prisma.aIJob.findMany({
    select: {
      prompt: true,
      predictions: {
        select: {
          id: true, confidence: true, outcome: true, marketType: true, selection: true,
          homeTeamApiId: true, awayTeamApiId: true, kickoff: true,
        },
      },
    },
  });

  const rows = jobs
    .filter((j) => {
      try {
        return (JSON.parse(j.prompt)?.categories ?? []).includes(BET_OF_THE_DAY);
      } catch {
        return false;
      }
    })
    .flatMap((j) => j.predictions);

  const decided = rows.filter((r) => (DECIDED as readonly string[]).includes(r.outcome));
  const pending = rows.length - decided.length;

  // Implied probability comes from the cached price for each pick's own
  // selection — the same lookup the display uses, so the two never disagree.
  const keys = [...new Set(decided.map((r) => matchKey(r)).filter((k): k is string => !!k))];
  const cached = keys.length
    ? await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys }, fetchedAt: { not: null } }, select: { matchKey: true, oddsJson: true } })
    : [];
  const oddsByKey = new Map(cached.map((c) => [c.matchKey, (c.oddsJson as unknown as FixtureOdds | null) ?? null]));

  const implied: number[] = [];
  for (const r of decided) {
    const key = matchKey(r);
    const gate = qualifiesForBetOfDay({
      odds: key ? (oddsByKey.get(key) ?? null) : null,
      marketType: r.marketType,
      selection: r.selection,
      confidence: r.confidence,
    });
    if (gate.price != null) implied.push(impliedProbability(gate.price));
  }

  const won = decided.filter((r) => r.outcome === "WON").length;
  const confidences = decided.map((r) => r.confidence);
  const meanConfidence = mean(confidences);
  const strike = decided.length ? (won / decided.length) * 100 : null;
  const gap = meanConfidence != null && strike != null ? meanConfidence - strike : null;

  // Binomial standard error on the observed strike rate, in percentage points.
  const se =
    decided.length > 0 && strike != null ? Math.sqrt(((strike / 100) * (1 - strike / 100)) / decided.length) * 100 : null;

  const buckets: CalibrationBucket[] = [];
  for (const [label, lo, hi] of [
    ["< 60%", 0, 60],
    ["60-69%", 60, 70],
    ["70-79%", 70, 80],
    ["80%+", 80, 101],
  ] as const) {
    const inBucket = decided.filter((r) => r.confidence >= lo && r.confidence < hi);
    if (inBucket.length === 0) continue;
    const w = inBucket.filter((r) => r.outcome === "WON").length;
    const mc = mean(inBucket.map((r) => r.confidence))!;
    const sr = (w / inBucket.length) * 100;
    buckets.push({
      label,
      settled: inBucket.length,
      won: w,
      meanConfidence: Number(mc.toFixed(1)),
      actualStrikeRate: Number(sr.toFixed(1)),
      gapPP: Number((mc - sr).toFixed(1)),
    });
  }

  const sampleMet = decided.length >= BET_OF_DAY_MIN_CALIBRATION_SAMPLE;
  // The gate refuses to rule before the sample floor. An early "pass" on six
  // settled picks would be the exact false comfort this is meant to prevent.
  const passes = !sampleMet || gap == null || se == null ? null : gap <= 2 * se;
  const significant = gap == null || se == null ? null : Math.abs(gap) > 2 * se;

  const verdict = !sampleMet
    ? `Not enough settled picks yet — ${decided.length}/${BET_OF_DAY_MIN_CALIBRATION_SAMPLE}. No volume increase until the sample floor is met.`
    : passes
      ? `Calibrated within noise (gap ${round(gap)}pp, 2 SE ${round(se != null ? se * 2 : null)}pp). A quota increase above ${BET_OF_DAY_DAILY_QUOTA}/day is supportable on this evidence.`
      : `Systematically overconfident by ${round(gap)}pp (beyond 2 SE ${round(se != null ? se * 2 : null)}pp). Hold the quota at ${BET_OF_DAY_DAILY_QUOTA}/day and fix calibration first.`;

  return {
    settled: decided.length,
    won,
    lost: decided.length - won,
    pending,
    meanConfidence: round(meanConfidence),
    meanImplied: round(mean(implied)),
    actualStrikeRate: round(strike),
    overconfidenceGapPP: round(gap),
    standardErrorPP: round(se),
    significant,
    buckets,
    gate: { minimumSample: BET_OF_DAY_MIN_CALIBRATION_SAMPLE, sampleMet, passes, verdict },
    quota: BET_OF_DAY_DAILY_QUOTA,
  };
}
