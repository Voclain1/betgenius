/**
 * Pure disposition of a dedicated early FREE prediction.
 *
 * No prediction is deleted due to absent opening prices or marginal evidence.
 * AUTO remains strictly gated by the existing bookmaker/evidence checks.
 * REVIEW joins the existing admin review queue (PENDING_REVIEW).
 * HOLD is a recoverable DRAFT state, revisited on every early-publish cycle.
 */
export const EARLY_REVIEW_CONFIDENCE_FLOOR = 65;
export const EARLY_HOLD_UNTIL_HOURS = 72;
export type EarlyDisposition = "auto" | "review" | "hold";

export function classifyEarlyDisposition(input: {
  confidence: number;
  leadHours: number;
  evidenceCredible: boolean;
  autoEligible: boolean;
  pricedExactSelection: boolean;
}): EarlyDisposition {
  const { confidence, leadHours, evidenceCredible, autoEligible, pricedExactSelection } = input;
  if (autoEligible && pricedExactSelection) return "auto";
  // Confidence close to the FREE 70 floor, with at least a credible basic
  // evidence package, is for human review regardless of bookmaker availability.
  if (confidence >= EARLY_REVIEW_CONFIDENCE_FLOOR && evidenceCredible) return "review";
  // Weak drafts more than three days ahead remain held, not discarded.
  // Within three days they join the admin review queue, clearly non-automatic.
  return leadHours <= EARLY_HOLD_UNTIL_HOURS ? "review" : "hold";
}
