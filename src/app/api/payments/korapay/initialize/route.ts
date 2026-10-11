import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
import { enabledMethods } from "@/lib/payments/methods";
import { initializeKorapay } from "@/lib/payments/korapay";

const Body = z.object({ tier: z.enum(["VIP", "PREMIUM"]) });

/** Starts a Korapay checkout. Tier only: the price comes from lib/pricing. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (!enabledMethods().includes("KORAPAY")) return NextResponse.json({ error: "Korapay isn't available right now." }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a plan." }, { status: 400 });
  try {
    const { link } = await initializeKorapay({ tier: parsed.data.tier, userId: session.user.id, email: session.user.email! });
    return NextResponse.json({ authorization_url: link });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Korapay error";
    console.error("Korapay checkout failed", { code: "INITIALIZE_FAILED", message });
    return NextResponse.json({ error: `Could not start checkout: ${message}` }, { status: 502 });
  }
}
