import { prisma } from "@/lib/prisma";
import { verifyTransaction } from "@/lib/paystack/paystack";
import { decideCheckoutGrant, type CheckoutDecision } from "@/lib/paystack/entitlement";
import { tierFromCheckoutReference } from "@/lib/paystack/checkoutReference";

/**
 * Apply a one-time checkout payment. THE ONLY PLACE ENTITLEMENT IS GRANTED
 * FOR A CHECKOUT.
 *
 * Two callers reach it: the Paystack webhook, and the callback verify route
 * the payer's browser hits on redirect. They must not be able to disagree
 * about what a payment buys, or to grant it twice between them, so they share
 * this one implementation rather than each doing their own lookup-verify-write.
 *
 * WHAT THE CALLBACK DOES NOT DO IS DECIDE. It supplies a reference and nothing
 * else. Access is granted from Paystack's own /transaction/verify response,
 * fetched here, every time — arriving on the callback URL proves nothing, and
 * `?paid=1` is not an input to this function at all.
 *
 * IDEMPOTENCY IS ENFORCED TWICE, deliberately:
 *   - decideCheckoutGrant rejects a reference already recorded in
 *     lastPaymentRef, which catches a redelivery arriving after the first
 *     grant has been written;
 *   - the write itself is a compare-and-set on paystackRef, which catches the
 *     webhook and the callback both reading the row before either writes. Only
 *     the update whose WHERE still matches the unspent reference lands; the
 *     loser updates zero rows and reports ALREADY_GRANTED.
 * The first alone would leave the race open, the second alone would lose the
 * audit trail. Both cost one query each.
 */
export type CheckoutPaymentResult =
  | { outcome: "GRANTED"; userId: string; tier: string; periodStart: Date; periodEnd: Date }
  | { outcome: "ALREADY_GRANTED" }
  | { outcome: "NOT_A_CHECKOUT" }
  | { outcome: "AMBIGUOUS" }
  | { outcome: "VERIFICATION_FAILED"; message: string }
  | { outcome: "REJECTED"; mismatches: unknown };

export async function applyCheckoutPayment(
  reference: string,
  /** When set, the reference must belong to this user's row — the callback
   *  passes the signed-in user so one payer cannot claim another's payment. */
  expectUserId?: string,
): Promise<CheckoutPaymentResult> {
  const matches = await prisma.subscription.findMany({
    where: { paystackRef: reference },
    select: {
      userId: true,
      tier: true,
      status: true,
      paystackRef: true,
      lastPaymentRef: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      user: { select: { email: true } },
    },
    take: 2,
  });
  if (matches.length > 1) return { outcome: "AMBIGUOUS" };

  const row = matches[0];
  if (!row) {
    // The reference is unknown as a live checkout. It is still ours — and
    // already paid — if some row recorded it as the payment it last applied,
    // which is exactly what the slower of the webhook/callback pair sees.
    const spent = await prisma.subscription.findFirst({
      where: { lastPaymentRef: reference },
      select: { userId: true },
    });
    return spent ? { outcome: "ALREADY_GRANTED" } : { outcome: "NOT_A_CHECKOUT" };
  }
  if (expectUserId && row.userId !== expectUserId) return { outcome: "NOT_A_CHECKOUT" };

  // The same guard the webhook has always applied: a row is only treated as a
  // checkout when the reference is one of ours (and so carries its tier), or
  // when it is still PENDING — which is what a checkout started before the
  // tier-carrying references shipped looks like. It keeps a recurring
  // renewal's reference, which is recorded on an ACTIVE row, out of this path.
  const checkoutTier = tierFromCheckoutReference(row.paystackRef);
  if (checkoutTier == null && row.status !== "PENDING") return { outcome: "NOT_A_CHECKOUT" };
  const purchasedTier = checkoutTier ?? row.tier;

  let verified;
  try {
    verified = await verifyTransaction(reference);
  } catch (error) {
    return {
      outcome: "VERIFICATION_FAILED",
      message: error instanceof Error ? error.message : "Unknown verification error",
    };
  }

  const decision: CheckoutDecision = decideCheckoutGrant(
    {
      userId: row.userId,
      userEmail: row.user.email,
      tier: row.tier,
      status: row.status,
      paystackRef: row.paystackRef,
      lastPaymentRef: row.lastPaymentRef,
      currentPeriodStart: row.currentPeriodStart,
      currentPeriodEnd: row.currentPeriodEnd,
    },
    purchasedTier,
    verified.data,
  );
  if (!decision.granted) {
    return decision.code === "ALREADY_GRANTED"
      ? { outcome: "ALREADY_GRANTED" }
      : { outcome: "REJECTED", mismatches: decision.mismatches };
  }

  // Compare-and-set. `paystackRef: reference` in the WHERE is the claim: the
  // first writer spends the reference by nulling it, so a concurrent caller's
  // identical update matches nothing. `tier` is written here rather than at
  // initialize, which is what lets an upgrade keep the tier it already paid
  // for until the new one is actually paid for.
  const claimed = await prisma.subscription.updateMany({
    where: { userId: row.userId, paystackRef: reference },
    data: {
      tier: decision.tier,
      status: "ACTIVE",
      currentPeriodStart: decision.periodStart,
      currentPeriodEnd: decision.periodEnd,
      paystackRef: null,
      lastPaymentRef: reference,
    },
  });
  if (claimed.count === 0) return { outcome: "ALREADY_GRANTED" };

  return {
    outcome: "GRANTED",
    userId: row.userId,
    tier: decision.tier,
    periodStart: decision.periodStart,
    periodEnd: decision.periodEnd,
  };
}
