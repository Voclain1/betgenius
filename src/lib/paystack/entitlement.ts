import { koboFor, type PaidTier } from "@/lib/pricing";

export type PendingEntitlement = {
  userId: string;
  userEmail: string;
  tier: string;
  paystackRef: string | null;
  status: string;
};

export type VerifiedPaystackTransaction = {
  status?: string;
  currency?: string;
  amount?: number;
  reference?: string;
  customer?: { email?: string };
  metadata?: { userId?: string; tier?: string };
};

export type EntitlementMismatch = {
  code: string;
  expected?: string | number | null;
  actual?: string | number | null;
};

function paidTier(value: string): value is PaidTier {
  return value === "VIP" || value === "PREMIUM";
}

/**
 * Decide entitlement only from the checkout row we created and Paystack's
 * independently-verified transaction. The webhook body is deliberately not an
 * input: its reference is only a lookup key used before this function runs.
 */
export function validateVerifiedEntitlement(
  pending: PendingEntitlement,
  transaction: VerifiedPaystackTransaction,
): EntitlementMismatch[] {
  const mismatches: EntitlementMismatch[] = [];

  // PENDING is a first or lapsed checkout. ACTIVE is a subscriber who already
  // had paid access when they started this one: the initialize route leaves
  // such a row alone rather than downgrading it to PENDING and taking away
  // access that was already paid for, so ACTIVE reaching here is expected, not
  // suspicious. Every other state (CANCELED, EXPIRED) would mean the row was
  // never put through a checkout, because initialize moves those to PENDING.
  if (pending.status !== "PENDING" && pending.status !== "ACTIVE") {
    mismatches.push({ code: "SUBSCRIPTION_NOT_CHECKING_OUT", expected: "PENDING_OR_ACTIVE", actual: pending.status });
  }
  if (!paidTier(pending.tier)) {
    mismatches.push({ code: "INVALID_PENDING_TIER", expected: "VIP_OR_PREMIUM", actual: pending.tier });
    return mismatches;
  }
  if (transaction.status !== "success") {
    mismatches.push({ code: "TRANSACTION_NOT_SUCCESSFUL", expected: "success", actual: transaction.status ?? null });
  }
  if (transaction.currency !== "NGN") {
    mismatches.push({ code: "CURRENCY_MISMATCH", expected: "NGN", actual: transaction.currency ?? null });
  }
  if (transaction.amount !== koboFor(pending.tier)) {
    mismatches.push({ code: "AMOUNT_MISMATCH", expected: koboFor(pending.tier), actual: transaction.amount ?? null });
  }
  if (!pending.paystackRef || transaction.reference !== pending.paystackRef) {
    mismatches.push({ code: "REFERENCE_MISMATCH", expected: pending.paystackRef, actual: transaction.reference ?? null });
  }

  const verifiedEmail = transaction.customer?.email?.trim().toLowerCase();
  if (!verifiedEmail || verifiedEmail !== pending.userEmail.trim().toLowerCase()) {
    mismatches.push({ code: "CUSTOMER_MISMATCH" });
  }
  if (transaction.metadata?.userId !== pending.userId) {
    mismatches.push({ code: "USER_MISMATCH", expected: pending.userId, actual: transaction.metadata?.userId ?? null });
  }
  if (transaction.metadata?.tier !== pending.tier) {
    mismatches.push({ code: "TIER_MISMATCH", expected: pending.tier, actual: transaction.metadata?.tier ?? null });
  }

  return mismatches;
}

/** One paid month. Every grant path extends by the same amount. */
export const PAID_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export type PaidPeriod = { start: Date; end: Date };

/**
 * The period a payment buys. THE ONLY PLACE A DURATION IS CALCULATED.
 *
 * Both grant paths route through here so a checkout and a recurring charge
 * cannot drift apart. That drift was real: the checkout path used to write
 * `now + PAID_PERIOD_MS` flat, so a subscriber who renewed on day 20 threw
 * away the ten days they had already paid for, while the renewal path
 * extended from the period end correctly. Under one-time payments EVERY
 * payment is a checkout, so that bug would have hit every early renewal.
 *
 * `end` extends from the later of now and the current period end — renewing
 * early adds a month on top rather than restarting it.
 *
 * `start` is the beginning of the access span the customer is currently in,
 * not of the month this payment added: extending an unexpired period keeps
 * the existing start, and a fresh or lapsed grant starts now. It is recorded
 * for display and support, and a null legacy value simply reads as now.
 * Access is gated on `end` alone (see lib/entitlement).
 */
export function nextPaidPeriod(
  sub: { currentPeriodStart?: Date | null; currentPeriodEnd: Date | null },
  now: Date = new Date(),
): PaidPeriod {
  const unexpired = sub.currentPeriodEnd != null && sub.currentPeriodEnd.getTime() > now.getTime();
  const from = unexpired ? sub.currentPeriodEnd! : now;
  return {
    start: unexpired ? sub.currentPeriodStart ?? now : now,
    end: new Date(from.getTime() + PAID_PERIOD_MS),
  };
}

export type RenewalDecision =
  | { granted: true; periodStart: Date; periodEnd: Date }
  | { granted: false; code: string };

/**
 * A recurring charge against an existing subscription.
 *
 * Paystack mints its own reference for every renewal invoice, so a renewal
 * matches no checkout we started and cannot go through the path above. That
 * did not matter while nothing enforced the paid period — an ACTIVE row simply
 * stayed ACTIVE — but it matters now that it does: without this, a customer
 * whose card is still being charged every month would be cut off after thirty
 * days. The transaction is Paystack's own verified one, and it must pay the
 * current tier's price in full, for the account that holds the subscription.
 *
 * Idempotent on the reference: the row records the renewal it last applied, so
 * a redelivered webhook extends nothing a second time.
 */
export function validateRenewal(
  sub: {
    tier: string;
    status: string;
    currentPeriodStart?: Date | null;
    currentPeriodEnd: Date | null;
    paystackRef: string | null;
    lastPaymentRef?: string | null;
  },
  transaction: VerifiedPaystackTransaction,
  now: Date = new Date(),
): RenewalDecision {
  if (transaction.status !== "success") return { granted: false, code: "TRANSACTION_NOT_SUCCESSFUL" };
  if (transaction.currency !== "NGN") return { granted: false, code: "CURRENCY_MISMATCH" };
  if (!paidTier(sub.tier)) return { granted: false, code: "NOT_A_PAID_PLAN" };
  if (transaction.amount !== koboFor(sub.tier)) return { granted: false, code: "AMOUNT_MISMATCH" };
  if (sub.status === "CANCELED") return { granted: false, code: "SUBSCRIPTION_CANCELED" };
  if (sub.paystackRef && transaction.reference === sub.paystackRef) {
    return { granted: false, code: "ALREADY_APPLIED" };
  }
  if (sub.lastPaymentRef && transaction.reference === sub.lastPaymentRef) {
    return { granted: false, code: "ALREADY_APPLIED" };
  }
  const period = nextPaidPeriod(sub, now);
  return { granted: true, periodStart: period.start, periodEnd: period.end };
}

export type CheckoutRow = PendingEntitlement & {
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  lastPaymentRef: string | null;
};

export type CheckoutDecision =
  | { granted: true; tier: PaidTier; periodStart: Date; periodEnd: Date }
  | { granted: false; code: "ALREADY_GRANTED" }
  | { granted: false; code: "MISMATCH"; mismatches: EntitlementMismatch[] };

/**
 * A one-time checkout payment against the row that started it.
 *
 * This is the whole grant rule for the one-time fallback, and it is pure so
 * every case below can be asserted without a database or a real charge:
 * see scripts/check-onetime-fallback.ts.
 *
 * ALREADY_GRANTED comes first and is not a failure. The callback verifies the
 * payment the moment Paystack redirects, and the webhook verifies it again
 * whenever it arrives — so the same transaction is presented twice by design,
 * often within the same second. Recognising the spent reference here is what
 * makes the second one a no-op instead of a free extra month. The database
 * write is claimed atomically as well (see applyCheckoutPayment), because two
 * callers can both read the row before either writes.
 *
 * Everything else is delegated to validateVerifiedEntitlement, so the one-time
 * path enforces exactly the checks the recurring path did: success status,
 * NGN, the tier's server-side price to the kobo, our own reference, the
 * customer's verified email, and the userId/tier metadata.
 */
export function decideCheckoutGrant(
  row: CheckoutRow,
  purchasedTier: string,
  transaction: VerifiedPaystackTransaction,
  now: Date = new Date(),
): CheckoutDecision {
  if (row.lastPaymentRef && transaction.reference === row.lastPaymentRef) {
    return { granted: false, code: "ALREADY_GRANTED" };
  }
  const mismatches = validateVerifiedEntitlement({ ...row, tier: purchasedTier }, transaction);
  if (mismatches.length > 0) return { granted: false, code: "MISMATCH", mismatches };
  if (!paidTier(purchasedTier)) return { granted: false, code: "MISMATCH", mismatches: [{ code: "INVALID_PENDING_TIER" }] };
  const period = nextPaidPeriod(row, now);
  return { granted: true, tier: purchasedTier, periodStart: period.start, periodEnd: period.end };
}
