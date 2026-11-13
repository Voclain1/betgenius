import { chronologicalHoldout } from "./paidChronologicalValidation";
import { oddsBand, segmentPaidPerformance, type SettledPaidObservation, type SegmentDimension } from "./paidMarketQuality";

export type ShadowPolicyReport = {
  dimension: SegmentDimension;
  splitAt: string | null;
  training: number;
  validation: number;
  selectedTrainingKeys: string[];
  baseline: { decided: number; priced: number; roiPct: number | null };
  candidate: { decided: number; priced: number; roiPct: number | null };
  warnings: string[];
  activationAllowed: false;
};

function key(row: SettledPaidObservation, dimension: SegmentDimension): string {
  switch (dimension) {
    case "market": return row.marketType || "unknown";
    case "league": return row.leagueApiId === null ? "unknown" : String(row.leagueApiId);
    case "provider": return row.provider || "unknown";
    case "oddsBand": return oddsBand(row.odds);
    case "confidenceBand": {
      const x = row.confidence;
      if (x === null || !Number.isFinite(x) || x < 0 || x > 100) return "unknown";
      const lower = Math.min(90, Math.floor(x / 10) * 10);
      return lower === 90 ? "90–100" : `${lower}–${lower + 9}`;
    }
  }
}

function performance(rows: readonly SettledPaidObservation[]) {
  const decided = rows.filter(r => r.outcome !== "VOID");
  const priced = decided.filter(r => r.priceSource === "entry" && r.odds !== null && Number.isFinite(r.odds) && r.odds > 1);
  const profit = priced.reduce((sum, r) => sum + (r.outcome === "WON" ? r.odds! - 1 : -1), 0);
  return { decided: decided.length, priced: priced.length, roiPct: priced.length >= 30 ? 100 * profit / priced.length : null };
}

/**
 * Select only from training history; compare with the untouched later holdout.
 * This is retrospective sensitivity analysis, NOT a point-in-time trading simulation:
 * settlement timing, bookmaker execution and prospective stability remain unproven.
 */
export function evaluateShadowSegmentPolicy(
  observations: readonly SettledPaidObservation[],
  dimension: SegmentDimension,
  options: { minTrainingSegment?: number; minTrainingPriced?: number; minValidation?: number } = {},
): ShadowPolicyReport {
  const split = chronologicalHoldout(observations, dimension);
  const time = split.splitAt ? Date.parse(split.splitAt) : null;
  const train = time === null ? [...observations] : observations.filter(r => r.kickoff.getTime() < time);
  const holdout = time === null ? [] : observations.filter(r => r.kickoff.getTime() >= time);
  const minTrainingSegment = options.minTrainingSegment ?? 60;
  const minTrainingPriced = options.minTrainingPriced ?? 40;
  const selectedTrainingKeys = segmentPaidPerformance(train, dimension, { minRoiSample: minTrainingPriced })
    .filter(s => s.decided >= minTrainingSegment && s.priced >= minTrainingPriced &&
      s.pricedCoverage >= 0.8 && s.roiPct !== null && s.roiPct > 0 &&
      s.winRateWilson95 !== null && s.winRateWilson95[0] > 0)
    .map(s => s.key);
  const chosen = new Set(selectedTrainingKeys);
  const candidate = holdout.filter(r => chosen.has(key(r, dimension)));
  const baseline = performance(holdout);
  const measured = performance(candidate);
  const warnings = [...split.warnings];
  if (!chosen.size) warnings.push("NO_TRAINING_SEGMENT_QUALIFIED");
  if (holdout.length < (options.minValidation ?? 30)) warnings.push("INSUFFICIENT_HOLDOUT");
  if (measured.priced < 30) warnings.push("INSUFFICIENT_CANDIDATE_ENTRY_PRICES");
  if (baseline.roiPct === null) warnings.push("BASELINE_ROI_UNVERIFIED");
  if (measured.roiPct === null) warnings.push("CANDIDATE_ROI_UNVERIFIED");
  if (measured.roiPct !== null && baseline.roiPct !== null && measured.roiPct <= baseline.roiPct)
    warnings.push("NO_HOLDOUT_ROI_IMPROVEMENT");
  warnings.push("RETROSPECTIVE_ONLY_NOT_POINT_IN_TIME_SETTLEMENT_VALIDATED");
  return { dimension, splitAt: split.splitAt, training: train.length, validation: holdout.length,
    selectedTrainingKeys, baseline, candidate: measured, warnings, activationAllowed: false };
}
