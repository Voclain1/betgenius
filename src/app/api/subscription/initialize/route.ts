import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initializeTransaction, PAYSTACK_PLANS } from "@/lib/paystack/paystack";
import { z } from "zod";

const Body = z.object({
  tier: z.enum(["VIP", "PREMIUM"]),
  amountKobo: z.number().int().positive(), // e.g. 5000 NGN = 500000
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const plan = parsed.data.tier === "VIP" ? PAYSTACK_PLANS.VIP : PAYSTACK_PLANS.PREMIUM;

  const init = await initializeTransaction({
    email: session.user.email!,
    amountKobo: parsed.data.amountKobo,
    plan: plan || undefined,
    callback_url: `${process.env.NEXTAUTH_URL}/dashboard?paid=1`,
    metadata: { userId: session.user.id, tier: parsed.data.tier },
  });

  await prisma.subscription.upsert({
    where: { userId: session.user.id },
    update: { tier: parsed.data.tier, status: "PENDING", paystackRef: init.data.reference },
    create: {
      userId: session.user.id,
      tier: parsed.data.tier,
      status: "PENDING",
      paystackRef: init.data.reference,
    },
  });

  return NextResponse.json({ authorization_url: init.data.authorization_url, reference: init.data.reference });
}
