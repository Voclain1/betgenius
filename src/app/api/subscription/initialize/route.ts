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
  // A missing plan code used to fall through as `plan: undefined`, which
  // Paystack happily accepts as a ONE-OFF charge. Checkout still looked
  // successful, but it sold a single month instead of a subscription and
  // nothing downstream could tell the two apart. Refuse the checkout instead
  // of taking money for the wrong thing.
  const plan = tier === "VIP" ? PAYSTACK_PLANS.VIP : PAYSTACK_PLANS.PREMIUM;
  if (!plan) {
    console.error("Paystack checkout blocked", { code: "PLAN_CODE_NOT_CONFIGURED", tier });
    return NextResponse.json({ error: "Checkout is unavailable for this tier" }, { status: 503 });
  }

  // Paystack rejects checkouts for reasons the visitor can act on (an address
  // it won't accept) and reasons they can't (an outage, a revoked key). An
  // unhandled throw here surfaced as a blank 500 with no body: the visitor saw
  // a dead button and the logs recorded nothing actionable. Name the failure.
  let init: Awaited<ReturnType<typeof initializeTransaction>>;
  try {
    init = await initializeTransaction({
      email: session.user.email!,
      amountKobo: koboFor(tier),
      plan,
      callback_url: `${process.env.NEXTAUTH_URL}/dashboard?paid=1`,
      metadata: { userId: session.user.id, tier: parsed.data.tier },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Paystack error";
    console.error("Paystack checkout failed", { code: "INITIALIZE_FAILED", tier, message });
    return NextResponse.json(
      { error: `Could not start checkout: ${message}` },
      { status: 502 },
    );
  }

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
