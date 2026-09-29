import { prisma } from "@/lib/prisma";
import { verifyTransaction } from "@/lib/paystack/paystack";
import { decideCheckoutGrant, type CheckoutDecision } from "@/lib/paystack/entitlement";
import { tierFromCheckoutReference } from "@/lib/paystack/checkoutReference";
import {
  recordEntitlementRejection,
  recordPaymentAttempt,
  recordVerificationFailure,
  toSafePaymentAttempt,
  type PaymentAttemptSource,
  type SafePaymentAttempt,
} from "@/lib/paystack/recordPaymentAttempt";

/**
 * Apply a one-time checkout payment. THE ONLY PLACE ENTITLEMENT IS GRANTED
 * FOR A CHECKOUT.
 *
 * Three callers reach it: the Paystack webhook, the callback verify route the
 * payer's browser hits on redirect, and the admin reconcile. They must not be
 * able to disagree about what a payment buys, or to grant it twice between
 * them, so they share this one implementation rather than each doing their own
 * lookup-verify-write.
 *
 * WHAT THE CALLBACK DOES NOT DO IS DECIDE. It supplies a reference and nothing
 * else. Access is granted from Paystack's own /transaction/verify response,
 * fetched here, every time — arriving on the callback URL proves nothing, and
 * `?paid=1` is not an input to this function at all.
 *
 * SUPERSEDED CHECKOUTS. Starting a checkout records its reference on the
 * subscription row, and starting another overwrites it. A payer who opens VIP,
 * backs out, opens Premium, and then completes the FIRST page — an old tab, or
 * a bank transfer that settles minutes later — used to present a reference no
 * row knew. The webhook then fell through to the recurring-renewal path, which
 * matched on email and required the price of whatever tier the row now said:
 * a different tier meant a 409, a charged customer and no access. A reference
 * of ours (bg_<TIER>_…) is now resolved to its owner through Paystack's own
 * verified metadata instead, and must pass every check a current one does:
 * success, NGN, the tier's price, the verified customer email, userId and tier
 * metadata. The owner's in-flight checkout is left alone.
 *
 * IDEMPOTENCY IS ENFORCED THREE TIMES, deliberately:
 *   - decideCheckoutGrant rejects a reference already recorded in
 *     lastPaymentRef, the cheap early exit for a redelivery;
 *   - the grant claims the reference's ledger entry
 *     (PaymentAttempt.entitlementGrantedAt) with a compare-and-set on null, in
 *     the same transaction as the subscription write. lastPaymentRef only
 *     remembers the latest payment; the ledger remembers every one, which is
 *     what stops an earlier reference re-granting once a later one has
 *     replaced it in lastPaymentRef;
 *   - the subscription write is itself a compare-and-set on the period end it
 *     was computed from (and, for a current checkout, on the unspent
 *     reference), so two payments landing at once cannot both extend from the
 *     same starting point and silently lose a month. The loser retries against
 *     the fresh row.
 */
export type CheckoutPaymentResult =
  | { outcome: "GRANTED"; userId: string; tier: string; periodStart: Date; periodEnd: Date }
  | { outcome: "ALREADY_GRANTED" }
  | { outcome: "NOT_A_CHECKOUT" }
  | { outcome: "AMBIGUOUS" }
  | { outcome: "VERIFICATION_FAILED"; message: string }
  | { outcome: "REJECTED"; mismatches: unknown; paystackStatus: string | null }
  | { outcome: "RETRY_LATER" };

/** Everything with a side effect, injectable so the flow is testable without a database or network. */
export type CheckoutDeps = {
  db: typeof prisma;
  verify: (reference: string) => Promise<{ data: any }>;
  record: typeof recordPaymentAttempt;
  recordVerifyFailure: typeof recordVerificationFailure;
  recordRejection: typeof recordEntitlementRejection;
  now: () => Date;
};

const defaultDeps = (): CheckoutDeps => ({
  db: prisma,
  verify: verifyTransaction,
  record: recordPaymentAttempt,
  recordVerifyFailure: recordVerificationFailure,
  recordRejection: recordEntitlementRejection,
  now: () => new Date(),
});

const ROW = {
  userId: true,
  tier: true,
  status: true,
  paystackRef: true,
  lastPaymentRef: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  user: { select: { email: true } },
} as const;

const RETRY = Symbol("retry");
class ConcurrentWrite extends Error {}

export async function applyCheckoutPayment(
  reference: string,
  /** When set, the reference must belong to this user — the callback passes
   *  the signed-in user so one payer cannot claim another's payment. */
  expectUserId?: string,
  /** Which path observed this attempt. Recording only; it changes no decision. */
  source: PaymentAttemptSource = "WEBHOOK",
  deps: CheckoutDeps = defaultDeps(),
): Promise<CheckoutPaymentResult> {
  // Only a concurrent write to the same subscription causes a retry, and each
  // retry re-reads the row, so a small bound is plenty. Exhausting it answers
  // RETRY_LATER, which the webhook turns into a non-200 so Paystack redelivers.
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await applyOnce(reference, expectUserId, source, deps);
    if (result !== RETRY) return result;
  }
  return { outcome: "RETRY_LATER" };
}

/** True when this reference has already bought its period, by either record. */
export async function referenceAlreadyGranted(db: CheckoutDeps["db"], reference: string): Promise<boolean> {
  const spent = await db.subscription.findFirst({ where: { lastPaymentRef: reference }, select: { userId: true } });
  if (spent) return true;
  const ledger = await db.paymentAttempt.findUnique({
    where: { reference },
    select: { entitlementGrantedAt: true },
  });
  return !!ledger?.entitlementGrantedAt;
}

async function applyOnce(
  reference: string,
  expectUserId: string | undefined,
  source: PaymentAttemptSource,
  deps: CheckoutDeps,
): Promise<CheckoutPaymentResult | typeof RETRY> {
  const { db } = deps;
  const referenceTier = tierFromCheckoutReference(reference);

  const matches = await db.subscription.findMany({ where: { paystackRef: reference }, select: ROW, take: 2 });
  if (matches.length > 1) return { outcome: "AMBIGUOUS" };

  let row: (typeof matches)[number] | null = matches[0] ?? null;
  const superseded = !row;
  if (!row) {
    // Unknown as a live checkout. Already paid for, if either record says so —
    // which is what the slower of the webhook/callback pair sees.
    if (await referenceAlreadyGranted(db, reference)) return { outcome: "ALREADY_GRANTED" };
    // Not one of ours: a recurring renewal (Paystack mints those references)
    // or something else entirely. The webhook's renewal path decides.
    if (!referenceTier) return { outcome: "NOT_A_CHECKOUT" };
  } else {
    if (expectUserId && row.userId !== expectUserId) return { outcome: "NOT_A_CHECKOUT" };
    // A row is only treated as a checkout when the reference is one of ours,
    // or when it is still PENDING — which is what a checkout started before
    // tier-carrying references shipped looks like.
    if (referenceTier == null && row.status !== "PENDING") return { outcome: "NOT_A_CHECKOUT" };
  }

  let verified;
  try {
    verified = await deps.verify(reference);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown verification error";
    await deps.recordVerifyFailure(reference, source, message, { userId: row?.userId ?? expectUserId ?? null });
    return { outcome: "VERIFICATION_FAILED", message };
  }
  const transaction = verified.data ?? {};

  if (!row) {
    // A superseded checkout: find its owner from Paystack's verified metadata,
    // which our server set at initialisation and no browser can alter. The
    // owner's email is still checked independently below.
    const ownerId = typeof transaction.metadata?.userId === "string" ? transaction.metadata.userId : null;
    await deps.record(transaction, source, { reference, userId: ownerId, tier: referenceTier });
    if (expectUserId && ownerId !== expectUserId) return { outcome: "NOT_A_CHECKOUT" };
    row = ownerId ? await db.subscription.findUnique({ where: { userId: ownerId }, select: ROW }) : null;
    if (!row) {
      return rejected(deps, reference, transaction, [{ code: ownerId ? "SUBSCRIPTION_NOT_FOUND" : "USER_MISMATCH" }]);
    }
  } else {
    // Observability, not a decision. Recorded before the grant rule runs so a
    // REJECTED or already-spent attempt is captured just as a successful one
    // is. It records only an allowlisted subset and cannot throw.
    await deps.record(transaction, source, { reference, userId: row.userId, tier: referenceTier ?? row.tier });
  }

  const purchasedTier = referenceTier ?? row.tier;
  const now = deps.now();
  const decision: CheckoutDecision = decideCheckoutGrant(
    {
      userId: row.userId,
      userEmail: row.user.email,
      tier: row.tier,
      status: row.status,
      // A superseded reference is checked against itself: it is the one
      // Paystack verified, and its binding to this user is the verified
      // metadata and email, not the row.
      paystackRef: superseded ? reference : row.paystackRef,
      lastPaymentRef: row.lastPaymentRef,
      currentPeriodStart: row.currentPeriodStart,
      currentPeriodEnd: row.currentPeriodEnd,
    },
    purchasedTier,
    transaction,
    now,
  );
  if (!decision.granted) {
    if (decision.code === "ALREADY_GRANTED") return { outcome: "ALREADY_GRANTED" };
    return rejected(deps, reference, transaction, decision.mismatches);
  }

  const safe = toSafePaymentAttempt(transaction, { reference, userId: row.userId, tier: purchasedTier });
  const owner = row;
  try {
    const granted = await db.$transaction(async (tx) => {
      if (!(await claimLedger(tx, reference, safe, source, now))) return false;
      const claimed = await tx.subscription.updateMany({
        where: superseded
          ? { userId: owner.userId, currentPeriodEnd: owner.currentPeriodEnd }
          : { userId: owner.userId, paystackRef: reference, currentPeriodEnd: owner.currentPeriodEnd },
        data: {
          tier: decision.tier,
          status: "ACTIVE",
          currentPeriodStart: decision.periodStart,
          currentPeriodEnd: decision.periodEnd,
          lastPaymentRef: reference,
          // A current checkout is spent by nulling it. A superseded one leaves
          // the newer checkout in flight untouched.
          ...(superseded ? {} : { paystackRef: null }),
        },
      });
      // The row moved since it was read: spent by a concurrent caller, or
      // extended by another payment. Roll the ledger claim back and re-read.
      if (claimed.count === 0) throw new ConcurrentWrite();
      return true;
    });
    if (!granted) return { outcome: "ALREADY_GRANTED" };
  } catch (error) {
    if (error instanceof ConcurrentWrite) return RETRY;
    // Two callers creating the same ledger row at once: the loser retries and
    // finds the reference spent.
    if ((error as { code?: string } | null)?.code === "P2002") return RETRY;
    throw error;
  }

  return {
    outcome: "GRANTED",
    userId: row.userId,
    tier: decision.tier,
    periodStart: decision.periodStart,
    periodEnd: decision.periodEnd,
  };
}

async function rejected(
  deps: CheckoutDeps,
  reference: string,
  transaction: { status?: string },
  mismatches: { code: string }[],
): Promise<CheckoutPaymentResult> {
  // Paystack's money moved and we refused it: the case an admin must see.
  // An abandoned or failed transaction refused for not being a success is
  // the ordinary case and is already visible from its status.
  if (transaction.status === "success") {
    await deps.recordRejection(reference, mismatches.map((m) => m.code));
  }
  return { outcome: "REJECTED", mismatches, paystackStatus: transaction.status ?? null };
}

/**
 * Claim a reference's ledger entry. True when this caller is the one that
 * grants; false when the reference has already bought its period.
 */
async function claimLedger(
  tx: Parameters<Parameters<CheckoutDeps["db"]["$transaction"]>[0]>[0],
  reference: string,
  safe: SafePaymentAttempt | null,
  source: PaymentAttemptSource,
  now: Date,
): Promise<boolean> {
  const claimed = await tx.paymentAttempt.updateMany({
    where: { reference, entitlementGrantedAt: null },
    data: { entitlementGrantedAt: now, entitlementError: null },
  });
  if (claimed.count > 0) return true;
  const existing = await tx.paymentAttempt.findUnique({ where: { reference }, select: { entitlementGrantedAt: true } });
  if (existing) return false;
  // The observability write is allowed to fail; the ledger is not. Create it
  // here if it is missing. A concurrent create fails on the unique reference.
  if (!safe) throw new Error("Cannot record a payment without a reference");
  await tx.paymentAttempt.create({ data: { ...safe, source, entitlementGrantedAt: now } });
  return true;
}
