import { MAX_GENERATION_ATTEMPTS, nextAttemptAt } from "@/lib/generation/selector";

/**
 * What a failed generation does to its ledger row. Pure.
 *
 * WHY OUTAGES ARE DIFFERENT. A fixture gets MAX_GENERATION_ATTEMPTS (3) tries
 * and is then dead-lettered (ABANDONED) for good. That is right for a fixture
 * that is itself broken. It is wrong when every model provider is down at
 * once: then every fixture fails identically, for a reason that has nothing to
 * do with the fixture, and a few hours' outage abandons a whole day's
 * discovery. Over 14 Oct – 13 Nov 2026, 112 of 121 abandoned fixtures were
 * exactly that ("Every AI provider failed: gemini … prepayment …" — a billing
 * outage), found by scripts/verify-paid-production.ts.
 *
 * So a provider-wide outage does not count as an attempt: the row stays FAILED,
 * keeps its attempt count, and is retried after PROVIDER_OUTAGE_RETRY_MS. It is
 * still bounded: the queue never offers a fixture past kickoff. And the run
 * that hit the outage stops (see runGeneration), so one outage costs one call,
 * not one per queued fixture.
 */
export const PROVIDER_OUTAGE_RETRY_MS = 60 * 60_000;

export function isProviderOutage(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  return e?.name === "AllProvidersFailedError" || /^Every AI provider failed/.test(e?.message ?? "");
}

export function ledgerFailureUpdate(priorAttempts: number, outage: boolean, now: Date): { status: "FAILED" | "ABANDONED"; attempts: number; nextAttemptAt: Date | null } {
  if (outage) return { status: "FAILED", attempts: priorAttempts, nextAttemptAt: new Date(now.getTime() + PROVIDER_OUTAGE_RETRY_MS) };
  const attempts = priorAttempts + 1;
  const retryAt = attempts >= MAX_GENERATION_ATTEMPTS ? null : nextAttemptAt(attempts, now);
  return { status: retryAt === null ? "ABANDONED" : "FAILED", attempts, nextAttemptAt: retryAt };
}
