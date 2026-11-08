import { NextResponse } from "next/server";
import { checkoutMethods, usdtDetails } from "@/lib/payments/methods";

export const dynamic = "force-dynamic";

/**
 * Which ways to pay are switched on, the primary first, and which one the
 * plan buttons use. Names only — no account details, no keys.
 */
export async function GET() {
  const { methods, primary } = checkoutMethods();
  return NextResponse.json({ methods, primary, usdtNetwork: usdtDetails().network });
}
