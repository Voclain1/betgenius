import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
import { approveManualPayment, rejectManualPayment } from "@/lib/payments/manual";

const Body = z.object({ action: z.enum(["approve", "reject"]), reason: z.string().trim().max(300).optional() });

/**
 * Approve: grants the paid period through lib/payments/grant (exactly once,
 * however many times it is pressed). Reject: tells the customer, grants nothing.
 * Only an admin can do either, and only after checking the money arrived.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const result =
    parsed.data.action === "approve"
      ? await approveManualPayment(params.id, session!.user.id)
      : await rejectManualPayment(params.id, session!.user.id, parsed.data.reason ?? "");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}
