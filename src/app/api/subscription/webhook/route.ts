import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPaystackSignature } from "@/lib/paystack/verifySignature";

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

  const event = JSON.parse(raw) as { event: string; data: any };
  const data = event.data ?? {};
  const email = data?.customer?.email as string | undefined;
  const meta = data?.metadata as { userId?: string; tier?: "VIP" | "PREMIUM" } | undefined;

  const user = meta?.userId
    ? await prisma.user.findUnique({ where: { id: meta.userId } })
    : email
    ? await prisma.user.findUnique({ where: { email } })
    : null;
  if (!user) return NextResponse.json({ ok: true });

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30-day default

  if (event.event === "charge.success") {
    await prisma.subscription.upsert({
      where: { userId: user.id },
      update: {
        status: "ACTIVE",
        tier: meta?.tier ?? "VIP",
        currentPeriodEnd: periodEnd,
        paystackRef: data.reference,
      },
      create: {
        userId: user.id,
        status: "ACTIVE",
        tier: meta?.tier ?? "VIP",
        currentPeriodEnd: periodEnd,
        paystackRef: data.reference,
      },
    });
  } else if (event.event === "subscription.create") {
    await prisma.subscription.update({
      where: { userId: user.id },
      data: { paystackSubCode: data.subscription_code, status: "ACTIVE" },
    });
  } else if (event.event === "subscription.disable" || event.event === "subscription.not_renew") {
    await prisma.subscription.update({ where: { userId: user.id }, data: { status: "CANCELED" } });
  } else if (event.event === "invoice.payment_failed") {
    await prisma.subscription.update({ where: { userId: user.id }, data: { status: "EXPIRED" } });
  }

  return NextResponse.json({ received: true });
}
