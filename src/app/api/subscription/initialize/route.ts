import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initializeTransaction } from "@/lib/paystack/paystack";
import { koboFor } from "@/lib/pricing";
import { newCheckoutReference } from "@/lib/paystack/checkoutReference";
import { recordCheckoutStart } from "@/lib/paystack/recordCheckoutStart";
import { z } from "zod";

/**
 * TEMPORARY: ONE-TIME PAYMENTS, NOT RECURRING SUBSCRIPTIONS.
 *
 * WHY. This Paystack integration has no active recurring-capable channel.
 * Paystack narrows a plan checkout to the channels that support recurring
 * billing — Card and Direct Debit — and neither is active here, so attaching a
 * plan resolved the channel list to literally `[]` and the hosted page died
 * with "There are no channels available to process this transaction". Every
 * VIP and Premium checkout was unsellable. Bank, Bank Transfer and USSD are
 * active and are perfectly valid for a ONE-TIME charge, so dropping the plan
 * sells a single 30-day period through the channels that do work.
 *
 * Commit 389ea0e deliberately made a missing plan code refuse the checkout,
 * because a silent `plan: undefined` sold one month while looking like a
 * subscription. That hazard has not gone away — it is now the intended
 * behaviour, declared here and reflected in the customer-facing copy, which
 * promises a 30-day period and does NOT advertise automatic renewal.
 *
 * RESTORING RECURRING BILLING. PAYSTACK_PLAN_VIP / PAYSTACK_PLAN_PREMIUM and
 * PAYSTACK_PLANS are deliberately left in place and unchanged. Once Paystack
 * activates Card or Direct Debit, put `plan` back on the initializeTransaction
 * call below (the parameter is still supported), restore the missing-plan
 * guard, and revert the copy. Nothing else here needs to move.
 */

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

  // Our own reference rather than Paystack's, because it carries the tier
  // being bought — see newCheckoutReference. The row can then be left alone
  // for a subscriber who already has paid access.
  const reference = newCheckoutReference(tier);

  // Paystack rejects checkouts for reasons the visitor can act on (an address
  // it won't accept) and reasons they can't (an outage, a revoked key). An
  // unhandled throw here surfaced as a blank 500 with no body: the visitor saw
  // a dead button and the logs recorded nothing actionable. Name the failure.
  let init: Awaited<ReturnType<typeof initializeTransaction>>;
  try {
    init = await initializeTransaction({
      email: session.user.email!,
      amountKobo: koboFor(tier),
      // NO `plan` — see the block comment at the top of this file.
      reference,
      callback_url: `${process.env.NEXTAUTH_URL}/dashboard?paid=1`,
      // cancel_action is Paystack's documented redirect for the "Cancel
      // payment" link on its hosted page. Without it a payer who cancels is
      // left on Paystack with nowhere to go. It lands on the plans with a
      // notice, and grants nothing — the page only reads it to say so.
      // userId and tier are the fields verification checks; this one is not.
      metadata: {
        userId: session.user.id,
        tier: parsed.data.tier,
        cancel_action: `${process.env.NEXTAUTH_URL}/pricing?checkout=cancelled`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Paystack error";
    console.error("Paystack checkout failed", { code: "INITIALIZE_FAILED", tier, message });
    return NextResponse.json(
      { error: `Could not start checkout: ${message}` },
      { status: 502 },
    );
  }

  // Starting a checkout must not cost the viewer access they already hold —
  // including access a payment granted a moment ago. See recordCheckoutStart
  // for why the access test lives in the write's WHERE clause rather than in a
  // read before it.
  await recordCheckoutStart(prisma, session.user.id, tier, init.data.reference);

  return NextResponse.json({ authorization_url: init.data.authorization_url, reference: init.data.reference });
}
