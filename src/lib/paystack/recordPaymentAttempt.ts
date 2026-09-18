import { prisma } from "@/lib/prisma";
import { classifyPaymentAttempt, type PaymentCategory } from "@/lib/paystack/failureCategory";
import { tierFromCheckoutReference } from "@/lib/paystack/checkoutReference";

/**
 * Record one payment attempt for the admin view.
 *
 * THIS MODULE IS OBSERVABILITY ONLY. It never grants, extends or revokes
 * entitlement, never decides anything about a payment, and never calls
 * Paystack to retry one. Everything it writes is derived from a transaction
 * that has already happened.
 *
 * IT MUST NEVER BREAK A PAYMENT. Every caller is on the path that grants
 * access, so a logging failure here — a dropped connection, a migration not
 * yet applied — must not cost a paying customer their entitlement. `record`
 * therefore swallows its own errors and reports them to the console instead of
 * throwing. That is the one place in this codebase where swallowing an error
 * is the correct behaviour, because the alternative is strictly worse.
 */

/**
 * THE ALLOWLIST. Only these fields are ever read off a Paystack transaction.
 *
 * Paystack's verify response also carries `authorization` (with
 * `authorization_code`, `bin`, `last4`, `exp_month/year`, `signature`),
 * `access_code`, the full `customer` object and the raw `log` of the payer's
 * session. NONE of it is read here, so none of it can reach the database by
 * accident — a field that is never extracted cannot be persisted. Widening
 * this type is the decision point for anyone tempted to store more, and
 * scripts/check-payment-observability.ts asserts that the extracted shape
 * contains no sensitive key even when handed a full payload.
 */
export type ObservableTransaction = {
  reference?: string | null;
  status?: string | null;
  channel?: string | null;
  gateway_response?: string | null;
  amount?: number | null;
  currency?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
  metadata?: { userId?: string | null; tier?: string | null } | null;
};

export type PaymentAttemptSource = "WEBHOOK" | "CALLBACK" | "RECONCILE";

export type SafePaymentAttempt = {
  reference: string;
  userId: string | null;
  tier: string | null;
  channel: string | null;
  status: string;
  category: PaymentCategory;
  gatewayResponse: string | null;
  amountKobo: number | null;
  currency: string | null;
  occurredAt: Date;
};

/** Every key this module is permitted to persist. Asserted by the tests. */
export const SAFE_FIELDS = [
  "reference",
  "userId",
  "tier",
  "channel",
  "status",
  "category",
  "gatewayResponse",
  "amountKobo",
  "currency",
  "occurredAt",
] as const;

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // Capped because it is rendered in the admin table, and because an
  // unexpectedly long value is a sign the field is not what we think it is.
  return trimmed ? trimmed.slice(0, 200) : null;
};

/**
 * Reduce a Paystack transaction to the safe subset. Pure — no IO — so the
 * tests can hand it a full, realistic payload including card and
 * authorization data and assert that none of it survives.
 */
export function toSafePaymentAttempt(
  transaction: ObservableTransaction,
  fallback: { reference?: string; userId?: string | null; tier?: string | null } = {},
): SafePaymentAttempt | null {
  const reference = text(transaction.reference) ?? text(fallback.reference);
  if (!reference) return null;

  const status = text(transaction.status) ?? "unknown";
  const gatewayResponse = text(transaction.gateway_response);

  // The tier a checkout was for is carried by our own reference, so it is
  // known even when metadata is absent — which is the case for every
  // transaction Paystack minted itself.
  const tier = tierFromCheckoutReference(reference) ?? text(transaction.metadata?.tier) ?? text(fallback.tier);

  const created = text(transaction.created_at);
  const occurredAt = created ? new Date(created) : new Date();

  return {
    reference,
    userId: text(transaction.metadata?.userId) ?? text(fallback.userId),
    tier,
    channel: text(transaction.channel),
    status,
    category: classifyPaymentAttempt({ status, gatewayResponse }),
    gatewayResponse,
    amountKobo: typeof transaction.amount === "number" && Number.isFinite(transaction.amount) ? transaction.amount : null,
    currency: text(transaction.currency),
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
  };
}

/**
 * Upsert the attempt. Keyed on the reference so the webhook, the callback and
 * a reconcile converge on one row per attempt rather than three.
 *
 * A later observation overwrites an earlier one, which is what we want: an
 * attempt seen as `abandoned` by a reconcile and later completed is a success,
 * and the row should say so.
 */
export async function recordPaymentAttempt(
  transaction: ObservableTransaction,
  source: PaymentAttemptSource,
  fallback: { reference?: string; userId?: string | null; tier?: string | null } = {},
): Promise<void> {
  try {
    const safe = toSafePaymentAttempt(transaction, fallback);
    if (!safe) return;
    await prisma.paymentAttempt.upsert({
      where: { reference: safe.reference },
      create: { ...safe, source },
      update: { ...safe, source, observedAt: new Date() },
    });
  } catch (error) {
    // Deliberately swallowed — see the module comment. Observability must
    // never be the reason a paid customer fails to get access.
    console.error("Payment attempt not recorded", {
      code: "PAYMENT_ATTEMPT_LOG_FAILED",
      source,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
