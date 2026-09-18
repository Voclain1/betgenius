import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { applyCheckoutPayment } from "@/lib/paystack/applyCheckoutPayment";
import { z } from "zod";

/**
 * Callback-triggered verification — what the payer's browser hits on return
 * from Paystack, so access unlocks in seconds instead of whenever the webhook
 * turns up.
 *
 * ARRIVING HERE GRANTS NOTHING. The route takes a reference and hands it to
 * applyCheckoutPayment, which fetches Paystack's own /transaction/verify
 * response and decides from that. A payer who types the callback URL, replays
 * it, or posts a stranger's reference gets exactly what an abandoned checkout
 * gets: nothing. The `?paid=1` on the callback URL is never read here.
 *
 * Three things keep it from being a way to claim someone else's payment:
 * the session is required, the reference must be recorded on the signed-in
 * user's own subscription row (`expectUserId`), and the transaction must still
 * pass every check the webhook applies — amount, currency, tier, email,
 * metadata, success status.
 *
 * It is a supplement to the webhook, never a replacement. The webhook remains
 * the path that works when the payer closes the tab, and both are idempotent
 * against each other by design.
 */
const Body = z.object({
  reference: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A transaction reference is required" }, { status: 400 });

  const result = await applyCheckoutPayment(parsed.data.reference, session.user.id, "CALLBACK");

  switch (result.outcome) {
    case "GRANTED":
    case "ALREADY_GRANTED":
      // Both mean the same thing to the browser: the payment is applied, go
      // and re-read the row. Which of the callback and the webhook won the
      // race is not the payer's business.
      return NextResponse.json({ activated: true });
    case "VERIFICATION_FAILED":
      console.error("Paystack callback verification failed", {
        code: "VERIFICATION_FAILED",
        message: result.message,
      });
      return NextResponse.json({ activated: false, error: "Could not reach Paystack" }, { status: 502 });
    case "REJECTED":
      console.error("Paystack callback entitlement rejected", { mismatches: result.mismatches });
      return NextResponse.json({ activated: false }, { status: 409 });
    default:
      // NOT_A_CHECKOUT / AMBIGUOUS. Nothing to apply, and deliberately not an
      // error the payer sees: an unpaid or abandoned checkout lands here, and
      // so does a reference that is not theirs. Neither grants access.
      return NextResponse.json({ activated: false });
  }
}
