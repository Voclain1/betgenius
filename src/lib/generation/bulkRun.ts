/** Shared by /api/admin/ai/bulk and scripts/check-bulk-generation-dedupe.ts. */

/**
 * How long into the request a bulk run may still start a new fixture, leaving headroom under maxDuration
 * (300 s) for the fixture already in progress (up to ~60 s with model
 * retries) and the response.
 */
export const BULK_TIME_BUDGET_MS = 220_000;

/**
 * What the panel shows for a fixture that failed: the kind of failure, in
 * plain words, without provider names or raw model text. The full error goes
 * to the server log.
 */
export function bulkFailureReason(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  const message = String((err as { message?: string } | null)?.message ?? "");
  if (name === "CertaintyLanguageError" || name === "HouseVoiceError") {
    return "Draft rejected by the writing checks. Run it again for a new draft.";
  }
  if (name === "ShortPriceError") {
    return "Only a Double Chance priced under 1.10 was drafted, which is not worth tipping. Run it again or skip this match.";
  }
  if (name === "AllProvidersFailedError" || name === "ModelUnavailableError" || name === "AbortError") {
    return "The generation service did not respond. Try again shortly.";
  }
  if (/real league name/i.test(message)) return "Unknown competition name; generate this one from the single-match form.";
  if (/quota|budget/i.test(message)) return "Football-data quota ran out mid-run.";
  return "Prediction generation failed. Try again shortly.";
}
