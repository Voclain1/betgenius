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

  if (pending.status !== "PENDING") {
    mismatches.push({ code: "SUBSCRIPTION_NOT_PENDING", expected: "PENDING", actual: pending.status });
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
