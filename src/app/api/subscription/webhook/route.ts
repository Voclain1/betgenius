import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPaystackSignature } from "@/lib/paystack/verifySignature";
import { verifyTransaction } from "@/lib/paystack/paystack";
import { validateRenewal } from "@/lib/paystack/entitlement";
import { applyCheckoutPayment } from "@/lib/paystack/applyCheckoutPayment";

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

    // The checkout path. Lookup, Paystack verification, the grant rule and the
    // idempotent write all live in applyCheckoutPayment, which the callback
    // verify route shares — the two entry points cannot drift or double-grant.
    const applied = await applyCheckoutPayment(webhookReference);
    if (applied.outcome === "GRANTED") {
      return NextResponse.json({ received: true });
    }
    if (applied.outcome === "ALREADY_GRANTED") {
      // A redelivery, or the callback having got here first. Not an error:
      // 200 stops Paystack retrying something already done.
      return NextResponse.json({ received: true });
    }
    if (applied.outcome === "AMBIGUOUS") {
      console.error("Paystack entitlement rejected", {
        code: "AMBIGUOUS_PENDING_REFERENCE",
        reference: webhookReference,
      });
      return NextResponse.json({ error: "Unique pending checkout not found" }, { status: 409 });
    }
    if (applied.outcome === "VERIFICATION_FAILED") {
      console.error("Paystack transaction verification failed", {
        reference: webhookReference,
        error: applied.message,
      });
      return NextResponse.json({ error: "Transaction verification failed" }, { status: 502 });
    }
    if (applied.outcome === "REJECTED") {
      console.error("Paystack entitlement rejected", {
        reference: webhookReference,
        mismatches: applied.mismatches,
      });
      return NextResponse.json({ error: "Transaction does not match pending checkout" }, { status: 409 });
    }

    // NOT_A_CHECKOUT falls through to the recurring path below. That path is
    // dormant while checkouts are one-time — Paystack mints its own reference
    // for a recurring invoice and we are issuing none — but it is left intact
    // and verified so restoring plans does not require rebuilding it.
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
      data: {
        status: "ACTIVE",
        currentPeriodStart: renewal.periodStart,
        currentPeriodEnd: renewal.periodEnd,
        paystackRef: webhookReference,
        lastPaymentRef: webhookReference,
      },
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
