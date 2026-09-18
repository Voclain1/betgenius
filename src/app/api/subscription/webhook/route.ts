import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPaystackSignature } from "@/lib/paystack/verifySignature";
import { verifyTransaction } from "@/lib/paystack/paystack";
import { PAID_PERIOD_MS, validateRenewal, validateVerifiedEntitlement } from "@/lib/paystack/entitlement";
import { tierFromCheckoutReference } from "@/lib/paystack/checkoutReference";

/**
 * Paystack webhook.
 * Configure your endpoint in the Paystack dashboard to POST here.
 * Events we handle:
 *   - charge.success  -> mark sub ACTIVE, set currentPeriodEnd
 *   - subscription.disable / subscription.not_renew -> mark CANCELED
 *   - invoice.payment_failed -> mark EXPIRED
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-paystack-signature");
  if (!verifyPaystackSignature(raw, sig)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let event: { event: string; data: any };
  try {
    event = JSON.parse(raw) as { event: string; data: any };
  } catch {
    console.error("Paystack webhook rejected", { code: "INVALID_JSON" });
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const data = event.data ?? {};

  if (event.event === "charge.success") {
    const webhookReference = typeof data.reference === "string" ? data.reference : null;
    if (!webhookReference) {
      console.error("Paystack entitlement rejected", { code: "MISSING_REFERENCE" });
      return NextResponse.json({ error: "Invalid transaction reference" }, { status: 400 });
    }

    // Verify with Paystack before deciding anything. The webhook body is a
    // claim; /transaction/verify is the fact, and both paths below are decided
    // from it.
    let verified;
    try {
      verified = await verifyTransaction(webhookReference);
    } catch (error) {
      console.error("Paystack transaction verification failed", {
        reference: webhookReference,
        error: error instanceof Error ? error.message : "Unknown verification error",
      });
      return NextResponse.json({ error: "Transaction verification failed" }, { status: 502 });
    }

    // A checkout we started. Matched on the reference alone: the status filter
    // that used to be part of this lookup would now reject upgrades, because a
    // subscriber who already has paid access keeps their ACTIVE row (see the
    // initialize route). A row is only treated as a checkout when the
    // reference is one of ours, or when it is still PENDING — which is what a
    // checkout started before this shipped looks like. That keeps a replayed
    // renewal, whose reference is recorded on an ACTIVE row, out of this path.
    const matches = await prisma.subscription.findMany({
      where: { paystackRef: webhookReference },
      include: { user: { select: { id: true, email: true } } },
      take: 2,
    });
    if (matches.length > 1) {
      console.error("Paystack entitlement rejected", {
        code: "AMBIGUOUS_PENDING_REFERENCE",
        reference: webhookReference,
      });
      return NextResponse.json({ error: "Unique pending checkout not found" }, { status: 409 });
    }
    const pending = matches[0];
    const checkoutTier = pending ? tierFromCheckoutReference(pending.paystackRef) : null;
    const isCheckout = pending != null && (checkoutTier != null || pending.status === "PENDING");

    if (isCheckout) {
      // What this checkout was for. The reference carries it; a legacy
      // reference falls back to the tier the old initialize route wrote.
      const purchasedTier = checkoutTier ?? pending.tier;

      // Unchanged in substance: amount, currency, reference, customer email,
      // metadata userId and metadata tier are all still cross-checked against
      // Paystack's own verified response. Only two inputs differ — the tier
      // comes from the checkout rather than the row, and the status check is
      // told that a preserved ACTIVE row is a legitimate payer.
      const mismatches = validateVerifiedEntitlement(
        {
          userId: pending.userId,
          userEmail: pending.user.email,
          tier: purchasedTier,
          paystackRef: pending.paystackRef,
          status: pending.status,
        },
        verified.data,
      );
      if (mismatches.length > 0) {
        console.error("Paystack entitlement rejected", { reference: webhookReference, mismatches });
        return NextResponse.json({ error: "Transaction does not match pending checkout" }, { status: 409 });
      }

      // The grant. `tier` is written here rather than at initialize, which is
      // what lets an upgrade keep the tier it already paid for until the new
      // one is actually paid for. Clearing paystackRef spends the reference: a
      // replayed charge.success for it no longer matches any row, so it cannot
      // extend the period a second time.
      await prisma.subscription.update({
        where: { userId: pending.userId },
        data: {
          tier: purchasedTier,
          status: "ACTIVE",
          currentPeriodEnd: new Date(Date.now() + PAID_PERIOD_MS),
          paystackRef: null,
        },
      });
      return NextResponse.json({ received: true });
    }

    // Otherwise a recurring charge: Paystack's own reference against a
    // subscription we already granted. Matched by the verified customer email.
    const email = verified.data?.customer?.email;
    const subscriber = email
      ? await prisma.user.findUnique({
          where: { email: email.trim().toLowerCase() },
          select: { id: true, subscription: true },
        })
      : null;
    if (!subscriber?.subscription) {
      console.error("Paystack entitlement rejected", {
        code: "PENDING_CHECKOUT_NOT_FOUND",
        reference: webhookReference,
      });
      return NextResponse.json({ error: "Unique pending checkout not found" }, { status: 409 });
    }

    const renewal = validateRenewal(subscriber.subscription, verified.data);
    if (!renewal.granted) {
      // A redelivery of a renewal we already applied is not an error.
      const status = renewal.code === "ALREADY_APPLIED" ? 200 : 409;
      console.error("Paystack renewal not applied", { reference: webhookReference, code: renewal.code });
      return NextResponse.json({ received: renewal.code === "ALREADY_APPLIED" }, { status });
    }

    await prisma.subscription.update({
      where: { userId: subscriber.id },
      // The reference is recorded so a redelivered renewal is a no-op.
      data: { status: "ACTIVE", currentPeriodEnd: renewal.periodEnd, paystackRef: webhookReference },
    });
  } else if (event.event === "subscription.create") {
    // A subscription lifecycle notification is not proof of payment. Access is
    // granted only by the verified charge.success path above.
    const customerEmail = data?.customer?.email as string | undefined;
    if (customerEmail && data.subscription_code) {
      await prisma.subscription.updateMany({
        where: { user: { email: customerEmail } },
        data: { paystackSubCode: data.subscription_code },
      });
    }
  } else if (event.event === "subscription.disable" || event.event === "subscription.not_renew") {
    const customerEmail = data?.customer?.email as string | undefined;
    if (customerEmail) {
      await prisma.subscription.updateMany({ where: { user: { email: customerEmail } }, data: { status: "CANCELED" } });
    }
  } else if (event.event === "invoice.payment_failed") {
    const customerEmail = data?.customer?.email as string | undefined;
    if (customerEmail) {
      await prisma.subscription.updateMany({ where: { user: { email: customerEmail } }, data: { status: "EXPIRED" } });
    }
  }

  return NextResponse.json({ received: true });
}
