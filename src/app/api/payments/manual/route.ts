import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
import { enabledMethods } from "@/lib/payments/methods";
import { openManualPayment } from "@/lib/payments/manual";

const Body = z.object({ tier: z.enum(["VIP", "PREMIUM"]), method: z.enum(["BANK", "USDT"]) });

/** Opens (or reuses) a bank-transfer / USDT payment request and returns its id for /pay/[id]. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a plan and a payment method." }, { status: 400 });
  if (!enabledMethods().includes(parsed.data.method)) return NextResponse.json({ error: "That payment method isn't available right now." }, { status: 400 });
  const id = await openManualPayment(session.user.id, parsed.data.tier, parsed.data.method);
  return NextResponse.json({ id });
}
