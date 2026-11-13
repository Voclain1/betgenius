import type { SettledPaidObservation } from "./paidMarketQuality";
import type { ShadowPolicyReport } from "./paidHoldoutPolicy";

/** Fail-closed readiness report. Does not enable any selection rule. */
export function assessPaidEvidenceReadiness(rows: readonly SettledPaidObservation[], policies: readonly ShadowPolicyReport[]) {
  const decided = rows.filter(r => r.outcome !== "VOID");
  const priced = decided.filter(r => r.priceSource === "entry" && r.odds !== null && Number.isFinite(r.odds) && r.odds > 1);
  const coverage = decided.length ? priced.length / decided.length : 0;
  const uniqueDays = new Set(priced.map(r => r.kickoff.toISOString().slice(0, 10))).size;
  const blockers: string[] = [];
  if (decided.length < 200) blockers.push("INSUFFICIENT_SETTLED_HISTORY");
  if (priced.length < 150) blockers.push("INSUFFICIENT_VERIFIED_ENTRY_QUOTES");
  if (coverage < 0.8) blockers.push("ENTRY_PRICE_COVERAGE_BELOW_80_PERCENT");
  if (uniqueDays < 30) blockers.push("INSUFFICIENT_TEMPORAL_SPREAD");
  if (!policies.length) blockers.push("NO_HOLDOUT_POLICY_EVALUATION");
  if (!policies.some(p => p.validation >= 30 && p.candidate.priced >= 30 &&
    p.uncertainty.candidateLower95Pct !== null && p.uncertainty.candidateLower95Pct > 0 &&
    p.candidate.roiPct !== null && p.baseline.roiPct !== null &&
    p.candidate.roiPct > p.baseline.roiPct &&
    p.uncertainty.candidatePriceCoverage >= 0.8))
    blockers.push("NO_SUPPORTED_HOLDOUT_IMPROVEMENT");
  blockers.push("PROSPECTIVE_POINT_IN_TIME_VALIDATION_REQUIRED");
  blockers.push("BOOKMAKER_EXECUTION_NOT_VERIFIED");
  return { decided: decided.length, entryPriced: priced.length, coverage, uniqueDays, blockers,
    retrospectiveReady: blockers.filter(b => b !== "PROSPECTIVE_POINT_IN_TIME_VALIDATION_REQUIRED" && b !== "BOOKMAKER_EXECUTION_NOT_VERIFIED").length === 0,
    activationAllowed: false as const };
}
