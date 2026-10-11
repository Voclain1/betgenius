import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { applyFlutterwaveTransaction } from "@/lib/payments/flutterwave";

const Body = z.object({ transactionId: z.string().regex(/^\d{1,20}$/) });

/**
 * The payer's return from Flutterwave. Hands the transaction id to the shared
 * verify-and-apply; arriving here grants nothing by itself, and the payment
 * must belong to the signed-in user. The webhook does the same independently.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ activated: false, paymentStatus: "unconfirmed" });
  const result = await applyFlutterwaveTransaction(parsed.data.transactionId, "CALLBACK", session.user.id);
  switch (result.outcome) {
    case "GRANTED":
    case "ALREADY_GRANTED":
      return NextResponse.json({ activated: true });
    case "NOT_PAID":
      return NextResponse.json({
        activated: false,
        paymentStatus: result.status === "failed" ? "failed" : result.status === "cancelled" ? "not_completed" : "pending",
      });
    case "VERIFICATION_FAILED":
      return NextResponse.json({ activated: false, error: "Could not reach Flutterwave" }, { status: 502 });
    default:
      return NextResponse.json({ activated: false, paymentStatus: "unconfirmed" });
  }
}
