import { createHash } from "node:crypto";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";

const Subscription = z.object({
  endpoint: z.string().url().max(2048).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname) && !url.hostname.endsWith(".local");
  }),
  keys: z.object({ p256dh: z.string().min(20).max(512), auth: z.string().min(8).max(256) }),
});

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = Subscription.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });

  const { endpoint, keys } = parsed.data;
  const endpointHash = hash(endpoint);
  const existing = await prisma.pushSubscription.findUnique({ where: { endpointHash } });
  if (existing && existing.userId !== session.user.id) {
    return NextResponse.json({ error: "This browser subscription belongs to another account. Log out there before enabling it here." }, { status: 409 });
  }
  const userAgent = req.headers.get("user-agent")?.slice(0, 250);
  await prisma.pushSubscription.upsert({
    where: { endpointHash },
    update: { p256dh: keys.p256dh, auth: keys.auth, userAgent },
    create: { userId: session.user.id, endpointHash, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
  });
  await prisma.notificationPreference.upsert({
    where: { userId: session.user.id },
    update: { pushEnabled: true },
    create: { userId: session.user.id, pushEnabled: true },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const endpoint = (await req.json().catch(() => null))?.endpoint;
  if (typeof endpoint !== "string") return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { userId: session.user.id, endpointHash: hash(endpoint) } });
  return NextResponse.json({ ok: true });
}
