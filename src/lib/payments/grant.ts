import { prisma } from "@/lib/prisma";
import { nextPaidPeriod } from "@/lib/paystack/entitlement";
import type { PaidTier } from "@/lib/pricing";

/**
 * Grant a paid period for a payment that did NOT come through Paystack:
 * Flutterwave, Korapay, or a bank / USDT transfer an admin has approved.
 *
 * Paystack keeps its own path (lib/paystack/applyCheckoutPayment), which is
 * bound to the checkout reference on the subscription row. Everything here
 * reuses the two guarantees that path relies on, so no provider can grant
 * twice or lose a month:
 *
 *   - THE LEDGER. One PaymentAttempt per reference; the grant claims it with a
 *     compare-and-set on entitlementGrantedAt, in the same transaction as the
 *     subscription write. A redelivered webhook, the payer's return racing the
 *     webhook, or an admin double-click all find it claimed and grant nothing.
 *   - THE PERIOD. nextPaidPeriod, the one place a duration is computed, and a
 *     compare-and-set on the period end it was computed from, so two payments
 *     landing at once both extend rather than one overwriting the other.
 *
 * Callers decide WHETHER a payment is genuine (verified with the provider, or
 * approved by an admin) before calling this. This only applies it.
 *
 * The ledger row is also what sends the receipt: lib/mail/producers reads
 * entitlementGrantedAt, whatever the provider.
 */
export type GrantInput = {
  reference: string;
  provider: "FLUTTERWAVE" | "KORAPAY" | "BANK" | "USDT";
  userId: string;
  tier: PaidTier;
  /** In the currency's minor unit: kobo for NGN, cents for USDT. */
  amountMinor: number;
  currency: "NGN" | "USDT";
  channel: string | null;
  occurredAt: Date;
  source: string;
};

export type GrantResult = { outcome: "GRANTED"; periodEnd: Date } | { outcome: "ALREADY_GRANTED" };

class ConcurrentWrite extends Error {}

export async function grantPayment(input: GrantInput, db = prisma, now: Date = new Date()): Promise<GrantResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        await tx.paymentAttempt.upsert({
          where: { reference: input.reference },
          create: {
            reference: input.reference,
            provider: input.provider,
            userId: input.userId,
            tier: input.tier,
            channel: input.channel,
            status: "success",
            category: "SUCCESS",
            amountKobo: input.amountMinor,
            currency: input.currency,
            occurredAt: input.occurredAt,
            paidAt: input.occurredAt,
            source: input.source,
          },
          update: { status: "success", category: "SUCCESS", paidAt: input.occurredAt },
        });
        const claimed = await tx.paymentAttempt.updateMany({
          where: { reference: input.reference, entitlementGrantedAt: null },
          data: { entitlementGrantedAt: now, entitlementError: null },
        });
        if (claimed.count === 0) return { outcome: "ALREADY_GRANTED" } as const;

        const sub = await tx.subscription.findUnique({
          where: { userId: input.userId },
          select: { currentPeriodStart: true, currentPeriodEnd: true },
        });
        const period = nextPaidPeriod(sub ?? { currentPeriodStart: null, currentPeriodEnd: null }, now);
        const data = {
          tier: input.tier,
          status: "ACTIVE",
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
          lastPaymentRef: input.reference,
        };
        if (!sub) {
          await tx.subscription.create({ data: { userId: input.userId, ...data } });
        } else {
          const written = await tx.subscription.updateMany({
            where: { userId: input.userId, currentPeriodEnd: sub.currentPeriodEnd },
            data,
          });
          // Another payment extended the period between the read and this
          // write: roll back (including the ledger claim) and recompute.
          if (written.count === 0) throw new ConcurrentWrite();
        }
        return { outcome: "GRANTED", periodEnd: period.end } as const;
      });
    } catch (error) {
      if (error instanceof ConcurrentWrite) continue;
      // Two callers creating the same ledger row or subscription at once.
      if ((error as { code?: string } | null)?.code === "P2002") continue;
      throw error;
    }
  }
  throw new Error("Could not apply the payment: the subscription kept changing");
}
