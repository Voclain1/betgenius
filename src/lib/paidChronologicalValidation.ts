/**
 * Chronological holdout evaluation for paid-market segments.
 * No shuffled splits, no post-kickoff data, no in-sample activation.
 */
import { segmentPaidPerformance, type SegmentDimension, type SegmentResult, type SettledPaidObservation } from "./paidMarketQuality";

export type HoldoutResult = {
  dimension: SegmentDimension;
  splitAt: string | null;
  trainingCount: number;
  validationCount: number;
  training: SegmentResult[];
  validation: SegmentResult[];
  warnings: string[];
};

/** Split strictly by kickoff timestamp so same-time fixtures never cross the boundary. */
export function chronologicalHoldout(
  observations: readonly SettledPaidObservation[],
  dimension: SegmentDimension,
  options: { validationFraction?: number; minTraining?: number; minValidation?: number } = {},
): HoldoutResult {
  const fraction = options.validationFraction ?? 0.3;
  if (!(fraction > 0 && fraction < 1)) throw new RangeError("validationFraction must be between zero and one");
  const minTraining = options.minTraining ?? 60;
  const minValidation = options.minValidation ?? 30;
  const ordered = observations
    .filter(r => r.kickoff instanceof Date && Number.isFinite(r.kickoff.getTime()))
    .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || a.id.localeCompare(b.id));
  const warnings: string[] = [];
  if (ordered.length !== observations.length) warnings.push("INVALID_KICKOFF_EXCLUDED");
  const boundary = Math.floor(ordered.length * (1 - fraction));
  const splitTime = ordered[boundary]?.kickoff.getTime();
  if (splitTime === undefined) {
    return { dimension, splitAt: null, trainingCount: ordered.length, validationCount: 0,
      training: segmentPaidPerformance(ordered, dimension), validation: [],
      warnings: [...warnings, "INSUFFICIENT_CHRONOLOGICAL_DATA"] };
  }
  const training = ordered.filter(r => r.kickoff.getTime() < splitTime);
  const validation = ordered.filter(r => r.kickoff.getTime() >= splitTime);
  if (training.length < minTraining) warnings.push("INSUFFICIENT_TRAINING_SAMPLE");
  if (validation.length < minValidation) warnings.push("INSUFFICIENT_VALIDATION_SAMPLE");
  if (training.length && validation.length && training[training.length - 1].kickoff.getTime() >= validation[0].kickoff.getTime()) {
    throw new Error("Chronological holdout boundary overlaps");
  }
  return {
    dimension, splitAt: new Date(splitTime).toISOString(),
    trainingCount: training.length, validationCount: validation.length,
    training: segmentPaidPerformance(training, dimension),
    validation: segmentPaidPerformance(validation, dimension),
    warnings,
  };
}

/**
 * Diagnostic only. A promising training segment is NOT a deployable rule:
 * even validation ROI needs sufficient priced samples and prospective evidence.
 */
export function validationWarnings(result: HoldoutResult): string[] {
  const warnings = [...result.warnings];
  const trainingKeys = new Set(result.training.map(r => r.key));
  for (const row of result.validation) {
    if (!trainingKeys.has(row.key)) warnings.push(`UNSEEN_VALIDATION_SEGMENT:${row.key}`);
    if (row.roiPct === null) warnings.push(`UNVERIFIED_VALIDATION_ROI:${row.key}`);
    if (row.pricedCoverage < 0.8) warnings.push(`LOW_VALIDATION_PRICE_COVERAGE:${row.key}`);
  }
  return warnings;
}
