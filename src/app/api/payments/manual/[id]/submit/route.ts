import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
import { submitManualPayment } from "@/lib/payments/manual";

const Body = z.object({ payerDetails: z.string().trim().min(3).max(200) });

/** "I've paid": the customer's claim, which only puts the request in the admin queue. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please fill this in so we can find your payment." }, { status: 400 });
  const result = await submitManualPayment(params.id, session.user.id, parsed.data.payerDetails);
  if (!result.ok) return NextResponse.json({ error: result.error === "CLOSED" ? "This payment has already been reviewed." : "Not found" }, { status: result.error === "CLOSED" ? 409 : 404 });
  return NextResponse.json({ ok: true });
}
