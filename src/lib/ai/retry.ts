/**
 * Retry policy for transient Gemini failures.
 *
 * Split out of gemini.ts so the policy can be exercised directly with injected
 * failures — the behaviour that matters here (how many attempts, how long
 * between them, what is and isn't retried) is not observable from the outside
 * when it's buried in a live API call.
 *
 * Note the @google/genai SDK CAN retry for us: ApiClient.apiCall wires up
 * p-retry, but only when httpOptions.retryOptions is supplied, and falls
 * through to a bare fetch otherwise — which is what our client does, so today
 * there is no retry at all. Its built-in policy is also wrong for us: it
 * retries 429 alongside 503, and retrying an exhausted quota just spends the
 * remainder faster.
 */

/**
 * Backoff schedule in ms. Array length IS the retry count, so three entries
 * means up to four attempts and ~17s of waiting worst-case. Both callers are
 * admin-triggered and bounded by their route's maxDuration, sized to allow it.
 */
export const RETRY_BACKOFF_MS = [2_000, 5_000, 10_000];
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;
const TOTAL_BACKOFF_S = RETRY_BACKOFF_MS.reduce((a, b) => a + b, 0) / 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Is this a "come back in a moment" failure rather than a broken request?
 *
 * Gemini returns 503 UNAVAILABLE when the model is under load — nothing about
 * the prompt is wrong, and the identical call usually succeeds seconds later.
 * That, and only that, is retried here. A 400 (malformed request), 401/403 (bad
 * key) or 429 (quota exhausted) will fail identically however long we wait, and
 * retrying quota errors in particular would burn the remaining budget faster;
 * all of those surface immediately.
 *
 * The SDK throws ApiError with a numeric `status` and a message holding the
 * stringified error body, but the same condition can arrive as a nested JSON
 * error or plain text depending on where it was raised, so all shapes match.
 */
export function isModelUnavailable(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown; message?: unknown; error?: { code?: unknown; status?: unknown } };
  if (e?.status === 503 || e?.code === 503 || e?.error?.code === 503) return true;
  if (e?.error?.status === "UNAVAILABLE") return true;
  const msg = typeof e?.message === "string" ? e.message : "";
  return /\b503\b|UNAVAILABLE|overloaded/i.test(msg);
}

/** Raised once the retries are spent, so callers can tell exhaustion from a hard failure. */
export class ModelUnavailableError extends Error {
  constructor(attempts: number, cause: unknown) {
    super(
      `Gemini is under high demand (503 UNAVAILABLE) — still unavailable after ${attempts} attempts across ${TOTAL_BACKOFF_S}s. Try again shortly.`,
      { cause },
    );
    this.name = "ModelUnavailableError";
  }
}

/**
 * Retries `call` through Gemini's high-demand 503s.
 *
 * Callers must wrap ONLY the model request, never the work that built its
 * input. In this app that input costs ~11 metered api-football calls (team
 * lookups, form, injuries, standings, h2h); a retry reuses it verbatim, so
 * nothing extra is billed against the daily football quota. Retrying a level up
 * would re-fetch all of it and charge those calls two and three times over.
 */
export async function withUnavailableRetry<T>(call: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (!isModelUnavailable(err)) throw err;
      if (attempt >= MAX_ATTEMPTS) throw new ModelUnavailableError(MAX_ATTEMPTS, err);
      const waitMs = RETRY_BACKOFF_MS[attempt - 1];
      console.warn(`[ai/gemini] ${label}: 503 unavailable on attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
}
