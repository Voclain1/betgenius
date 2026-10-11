import { NextResponse } from "next/server";
import { enabledMethods, usdtDetails } from "@/lib/payments/methods";

export const dynamic = "force-dynamic";

/** Which ways to pay are switched on. Names only — no account details, no keys. */
export async function GET() {
  return NextResponse.json({ methods: enabledMethods(), usdtNetwork: usdtDetails().network });
}
