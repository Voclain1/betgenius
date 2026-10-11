import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { applyKorapayCharge } from "@/lib/payments/korapay";

const Body = z.object({ reference: z.string().regex(/^kp_(VIP|PREMIUM)_[0-9a-f]{32}$/) });

/**
 * The payer's return from Korapay. Hands our reference to the shared
 * verify-and-apply; arriving here grants nothing by itself, and the payment
 * must belong to the signed-in user. The webhook does the same independently.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ activated: false, paymentStatus: "unconfirmed" });
  const result = await applyKorapayCharge(parsed.data.reference, "CALLBACK", session.user.id);
  switch (result.outcome) {
    case "GRANTED":
    case "ALREADY_GRANTED":
      return NextResponse.json({ activated: true });
    case "NOT_PAID":
      // Anything not yet final (a transfer still landing) keeps polling.
      return NextResponse.json({
        activated: false,
        paymentStatus: result.status === "failed" ? "failed" : result.status === "expired" ? "not_completed" : "pending",
      });
    case "VERIFICATION_FAILED":
      return NextResponse.json({ activated: false, error: "Could not reach Korapay" }, { status: 502 });
    default:
      return NextResponse.json({ activated: false, paymentStatus: "unconfirmed" });
  }
}
