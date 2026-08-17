import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initializeTransaction, PAYSTACK_PLANS } from "@/lib/paystack/paystack";
import { koboFor } from "@/lib/pricing";
import { z } from "zod";

// Tier only. The amount is NOT accepted from the client: it used to be, which
// made the price whatever the browser claimed it was. It's derived from the
// tier server-side now (see koboFor). An amountKobo in the body is ignored
// rather than rejected, so a stale client can't be broken by it.
const Body = z.object({
  tier: z.enum(["VIP", "PREMIUM"]),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const tier = parsed.data.tier;
  const plan = tier === "VIP" ? PAYSTACK_PLANS.VIP : PAYSTACK_PLANS.PREMIUM;

  const init = await initializeTransaction({
    email: session.user.email!,
    amountKobo: koboFor(tier),
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
