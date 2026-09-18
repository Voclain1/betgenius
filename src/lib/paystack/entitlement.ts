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

/** One paid month. Both grant paths extend by the same amount. */
export const PAID_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export type RenewalDecision =
  | { granted: true; periodEnd: Date }
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
  sub: { tier: string; status: string; currentPeriodEnd: Date | null; paystackRef: string | null },
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
  // From the later of now and the current period end, so renewing early adds a
  // month rather than throwing the remainder away.
  const from = sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now.getTime() ? sub.currentPeriodEnd : now;
  return { granted: true, periodEnd: new Date(from.getTime() + PAID_PERIOD_MS) };
}
