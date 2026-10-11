import { NextResponse } from "next/server";
import { applyFlutterwaveTransaction, validFlutterwaveSignature } from "@/lib/payments/flutterwave";

/**
 * Flutterwave webhook. Set this URL and the secret hash (FLUTTERWAVE_SECRET_HASH)
 * in the Flutterwave dashboard. The body is used only for the transaction id:
 * the payment is re-fetched from Flutterwave's verify endpoint before anything
 * is granted. This is what confirms a payment whose payer closed the tab.
 */
export async function POST(req: Request) {
  if (!validFlutterwaveSignature(req.headers.get("verif-hash"))) return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { event?: string; data?: { id?: number | string } } | null;
  const id = body?.data?.id;
  if (body?.event !== "charge.completed" || id == null) return NextResponse.json({ received: true });
  const result = await applyFlutterwaveTransaction(String(id), "WEBHOOK");
  if (result.outcome === "VERIFICATION_FAILED") {
    // Non-200 so Flutterwave retries later.
    return NextResponse.json({ error: "Verification failed" }, { status: 502 });
  }
  return NextResponse.json({ received: true });
}
