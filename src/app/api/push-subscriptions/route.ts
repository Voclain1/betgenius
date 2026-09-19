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
  /**
   * Where this subscription came from, and therefore what the user was shown
   * before they agreed.
   *
   * "onboarding" means they accepted the first-visit prompt, which names
   * followed teams and leagues, Match Insights AND Bet of the Day /
   * top-prediction alerts. Accepting it is consent to that list, so it is the
   * one path that opts the user into editorial broadcasts.
   *
   * Anything else — the settings panel, a re-persist after losing a
   * subscription — carries no such statement, so it must not flip the flag.
   * That is why this is an explicit field rather than something inferred from
   * the request: two callers hit this endpoint and only one of them asked the
   * question.
   */
  source: z.enum(["onboarding", "settings"]).optional(),
});

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = Subscription.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });

  const { endpoint, keys, source } = parsed.data;
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
  // editorialAlerts is written ONLY on the onboarding path, and only ever to
  // true. Omitting the field otherwise is what keeps a settings-panel enable,
  // or a silent re-persist of an existing subscription, from opting someone
  // into broadcasts they were never told about — and from overwriting a
  // deliberate opt-out on the way past.
  const optIntoEditorial = source === "onboarding";
  await prisma.notificationPreference.upsert({
    where: { userId: session.user.id },
    update: { pushEnabled: true, ...(optIntoEditorial ? { editorialAlerts: true } : {}) },
    create: { userId: session.user.id, pushEnabled: true, ...(optIntoEditorial ? { editorialAlerts: true } : {}) },
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
