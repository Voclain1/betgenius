import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
import { pushConfigured, sendPush } from "@/lib/push";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (!pushConfigured()) return NextResponse.json({ error: "Push is not configured." }, { status: 503 });

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: session.user.id }, take: 5 });
  if (!subscriptions.length) return NextResponse.json({ error: "Enable push on this device first." }, { status: 400 });

  let sent = 0;
  for (const sub of subscriptions) {
    try {
      const payload = { title: "BetGenius test", body: "Push notifications are working on this device.", url: "/notifications", tag: `push-test-${session.user.id}` };
      if (await sendPush(sub, payload)) sent++;
    } catch {
      // One device's transient failure should not hide the others' result.
    }
  }
  return NextResponse.json({ sent });
}
