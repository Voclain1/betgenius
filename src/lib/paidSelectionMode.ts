import type { CalibrationArtifact } from "@/lib/calibration";
import { CALIBRATION_ARTIFACT } from "@/lib/calibrationArtifact";

/**
 * Feature flags for value-based paid selection. Read per call, so a change to
 * the environment takes effect on the next run without a deploy.
 *
 * PAID_SELECTION_MODE
 *   current  Paid curation exactly as PR #175 shipped it. No assessment, no log.
 *   shadow   (default) Live decisions unchanged. Every paid curation run also
 *            assesses each candidate for calibrated probability and value at the
 *            price available at that moment, and records the result as a
 *            `paid-selection-shadow` JobRun. That is the point-in-time record the
 *            historical data cannot provide (FixtureOddsCache keeps only the last
 *            quote), and what any future activation must be judged on.
 *   value    Live: a candidate is admitted only if it passes the #175 rule AND
 *            the value assessment, ranked by lower-bound expected value with a
 *            per-market cap. Takes effect only with an ACTIVE calibration
 *            artifact; without one, or when no candidate on the day has a usable
 *            price, curation falls back to the #175 rule and says so in the log.
 *
 * PAID_VALUE_MIN_EV_LOWER  Bar the lower-bound EV must clear in value mode (default 0).
 * PAID_CALIBRATION_DISABLED=1  Treat the artifact as absent everywhere (rollback switch).
 */
export type PaidSelectionMode = "current" | "shadow" | "value";

export function paidSelectionMode(env: NodeJS.ProcessEnv = process.env): PaidSelectionMode {
  const v = env.PAID_SELECTION_MODE?.trim().toLowerCase();
  return v === "current" || v === "value" ? v : "shadow";
}

export function paidValueMinEvLower(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PAID_VALUE_MIN_EV_LOWER);
  return Number.isFinite(n) && env.PAID_VALUE_MIN_EV_LOWER?.trim() ? n : 0;
}

/** The committed artifact, for assessment (shadow logs record it even when inactive). Null when disabled. */
export function calibrationArtifact(env: NodeJS.ProcessEnv = process.env, artifact: CalibrationArtifact | null = CALIBRATION_ARTIFACT): CalibrationArtifact | null {
  return env.PAID_CALIBRATION_DISABLED === "1" ? null : artifact;
}

/** The artifact live decisions may use: present, not disabled, and marked active by its out-of-sample evidence. */
export function activeCalibration(env: NodeJS.ProcessEnv = process.env, artifact: CalibrationArtifact | null = CALIBRATION_ARTIFACT): CalibrationArtifact | null {
  const a = calibrationArtifact(env, artifact);
  return a?.active ? a : null;
}

/** What paid curation actually does this run, given the flag and the artifact. */
export function effectivePaidSelection(env: NodeJS.ProcessEnv = process.env, artifact: CalibrationArtifact | null = CALIBRATION_ARTIFACT): { mode: PaidSelectionMode; live: "current" | "value"; fallback: string | null } {
  const mode = paidSelectionMode(env);
  if (mode !== "value") return { mode, live: "current", fallback: null };
  if (!activeCalibration(env, artifact)) return { mode, live: "current", fallback: "NO_ACTIVE_CALIBRATION" };
  return { mode, live: "value", fallback: null };
}
