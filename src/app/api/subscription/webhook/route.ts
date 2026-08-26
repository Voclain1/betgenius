import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPaystackSignature } from "@/lib/paystack/verifySignature";
import { verifyTransaction } from "@/lib/paystack/paystack";
import { validateVerifiedEntitlement } from "@/lib/paystack/entitlement";

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

    const pendingMatches = await prisma.subscription.findMany({
      where: { paystackRef: webhookReference, status: "PENDING" },
      include: { user: { select: { id: true, email: true } } },
      take: 2,
    });
    if (pendingMatches.length !== 1) {
      console.error("Paystack entitlement rejected", {
        code: pendingMatches.length === 0 ? "PENDING_CHECKOUT_NOT_FOUND" : "AMBIGUOUS_PENDING_REFERENCE",
        reference: webhookReference,
      });
      return NextResponse.json({ error: "Unique pending checkout not found" }, { status: 409 });
    }
    const pending = pendingMatches[0];

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

    const mismatches = validateVerifiedEntitlement(
      {
        userId: pending.userId,
        userEmail: pending.user.email,
        tier: pending.tier,
        paystackRef: pending.paystackRef,
        status: pending.status,
      },
      verified.data,
    );
    if (mismatches.length > 0) {
      console.error("Paystack entitlement rejected", {
        reference: webhookReference,
        mismatches,
      });
      return NextResponse.json({ error: "Transaction does not match pending checkout" }, { status: 409 });
    }

    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.subscription.update({
      where: { userId: pending.userId },
      data: { status: "ACTIVE", currentPeriodEnd: periodEnd },
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
