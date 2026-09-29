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
  /** Read ONLY through summariseSessionLog, which keeps counts, method names
   *  and error text and drops everything else. */
  log?: PaystackSessionLog | null;
};

export type PaystackSessionLog = {
  time_spent?: number | null;
  attempts?: number | null;
  errors?: number | null;
  history?: Array<{ type?: string | null; message?: string | null; time?: number | null }> | null;
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
  paidAt: Date | null;
} & SessionSummary;

export type SessionSummary = {
  sessionLogged: boolean;
  methodsTried: string | null;
  authAttempts: number | null;
  sessionError: string | null;
  timeSpentSec: number | null;
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
  "paidAt",
  "sessionLogged",
  "methodsTried",
  "authAttempts",
  "sessionError",
  "timeSpentSec",
] as const;

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // Capped because it is rendered in the admin table, and because an
  // unexpectedly long value is a sign the field is not what we think it is.
  return trimmed ? trimmed.slice(0, 200) : null;
};

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

const date = (value: unknown): Date | null => {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// Paystack's own method identifiers: bank_transfer, ussd, zap, opay, card...
const METHOD = /^set payment method to:\s*([a-z_]+)$/i;

/**
 * How far the payer got, from Paystack's checkout session log.
 *
 * WHY. Paystack's `channel` on an abandoned transaction is NOT the method the
 * payer used — it is a default assigned at initialisation. In production,
 * checkouts that were created by a script and never opened by anyone carry
 * `card` or `bank` seemingly at random, so a channel table built from it
 * reported "card: 0 paid / 9 not completed" about checkouts in which no card
 * was ever entered. The session log is the only evidence of what actually
 * happened on the page.
 *
 * WHAT IS KEPT. Counts, the method names Paystack logs when the payer switches
 * method, and the text of `error` entries (fixed Paystack descriptors such as
 * "Denied by Fraud System."), with any long digit run masked in case an error
 * ever quotes an account number. `input` entries and every other message are
 * dropped unread — they are where anything the payer typed would appear.
 *
 * NO LOG IS EVIDENCE TOO, but only of absence: Paystack recorded no activity.
 * Whether the page failed to load or the payer closed it untouched cannot be
 * told apart from here, and nothing downstream pretends otherwise.
 */
export function summariseSessionLog(log: PaystackSessionLog | null | undefined): SessionSummary {
  const history = Array.isArray(log?.history) ? log!.history! : [];
  if (!log || (history.length === 0 && count(log.time_spent) == null && count(log.attempts) == null)) {
    return { sessionLogged: false, methodsTried: null, authAttempts: null, sessionError: null, timeSpentSec: null };
  }
  const methods: string[] = [];
  let sessionError: string | null = null;
  for (const entry of history) {
    const message = typeof entry?.message === "string" ? entry.message.trim() : "";
    const method = METHOD.exec(message)?.[1]?.toLowerCase();
    if (method && method !== "null" && methods[methods.length - 1] !== method) methods.push(method);
    if (!sessionError && entry?.type === "error" && message) {
      sessionError = message.replace(/^error:\s*/i, "").replace(/\d{4,}/g, "#").slice(0, 120) || null;
    }
  }
  return {
    sessionLogged: true,
    methodsTried: methods.length ? methods.join(",").slice(0, 200) : null,
    authAttempts: count(log.attempts),
    sessionError,
    timeSpentSec: count(log.time_spent),
  };
}

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
    paidAt: date(transaction.paid_at),
    ...summariseSessionLog(transaction.log),
  };
}

/** Which of our entry points saw the attempt, as a timestamp column. */
function seenBy(source: PaymentAttemptSource, now: Date) {
  if (source === "WEBHOOK") return { webhookAt: now };
  if (source === "CALLBACK") return { callbackAt: now };
  return {};
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
    const now = new Date();
    // A successful observation clears an earlier verification error: whatever
    // it described has since been overcome.
    await prisma.paymentAttempt.upsert({
      where: { reference: safe.reference },
      create: { ...safe, source, ...seenBy(source, now) },
      update: { ...safe, source, observedAt: now, verifyError: null, ...seenBy(source, now) },
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

/**
 * Our server could not fetch Paystack's record of a reference — Paystack down,
 * a revoked key, a network fault. The webhook answers non-200 so Paystack
 * retries; this makes the failure visible in the admin view rather than only
 * in a function log. It never overwrites what Paystack already told us about
 * the attempt: an existing row keeps its status and category.
 */
export async function recordVerificationFailure(
  reference: string,
  source: PaymentAttemptSource,
  message: string,
  fallback: { userId?: string | null; tier?: string | null } = {},
): Promise<void> {
  try {
    const now = new Date();
    const verifyError = message.replace(/sk_(live|test)_\w+/gi, "sk_***").slice(0, 200);
    await prisma.paymentAttempt.upsert({
      where: { reference },
      create: {
        reference,
        userId: fallback.userId ?? null,
        tier: tierFromCheckoutReference(reference) ?? fallback.tier ?? null,
        status: "unverified",
        category: "VERIFICATION_FAILED",
        occurredAt: now,
        source,
        verifyError,
        ...seenBy(source, now),
      },
      update: { verifyError, observedAt: now, ...seenBy(source, now) },
    });
  } catch (error) {
    console.error("Payment attempt not recorded", {
      code: "PAYMENT_ATTEMPT_LOG_FAILED",
      source,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/** Paystack reported success but we refused the grant. Observability only. */
export async function recordEntitlementRejection(reference: string, codes: string[]): Promise<void> {
  try {
    await prisma.paymentAttempt.updateMany({
      where: { reference },
      data: { entitlementError: codes.join(",").slice(0, 200) || "REJECTED" },
    });
  } catch (error) {
    console.error("Payment attempt not recorded", {
      code: "PAYMENT_ATTEMPT_LOG_FAILED",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
