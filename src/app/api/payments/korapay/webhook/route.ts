import { NextResponse } from "next/server";
import { applyKorapayCharge, validKorapaySignature } from "@/lib/payments/korapay";

/**
 * Korapay webhook. Each checkout sends this URL as its notification_url, so
 * nothing needs setting in the Korapay dashboard. The body is used only for
 * the reference: the charge is re-fetched from Korapay before anything is
 * granted. This is what confirms a payment whose payer closed the tab, e.g. a
 * bank transfer that lands minutes later.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!validKorapaySignature(raw, req.headers.get("x-korapay-signature"))) return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  let body: { event?: string; data?: { reference?: string } } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ received: true });
  }
  const reference = body?.data?.reference;
  if (!reference || (body?.event !== "charge.success" && body?.event !== "charge.failed")) return NextResponse.json({ received: true });
  const result = await applyKorapayCharge(reference, "WEBHOOK");
  if (result.outcome === "VERIFICATION_FAILED") {
    // Non-200 so Korapay retries later.
    return NextResponse.json({ error: "Verification failed" }, { status: 502 });
  }
  return NextResponse.json({ received: true });
}
