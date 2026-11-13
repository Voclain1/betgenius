/**
 * Independent control for the Sprint 05 candidate-quality layer
 * (paidCandidateQuality.ts). Separate from COVERAGE_ROLLOUT (discovery) and
 * PAID_SELECTION_MODE (VIP / PREMIUM qualification).
 *
 *   off     no quality record is written.
 *   shadow  (default, and what ANY other value means) decisions are recorded
 *           in the paid-selection shadow log and never read by curation.
 *
 * There is deliberately no "on": the quality policy failed chronological
 * validation (docs/vip-sprint05-evidence.md), and activating any version of it
 * requires a code change reviewed against new evidence, not a setting.
 */
export type PaidQualityPolicyMode = "off" | "shadow";

export function paidQualityPolicyMode(env: Record<string, string | undefined> = process.env): PaidQualityPolicyMode {
  return (env.PAID_QUALITY_POLICY ?? "").trim().toLowerCase() === "off" ? "off" : "shadow";
}
