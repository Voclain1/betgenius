import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
import { canViewCategory } from "@/lib/access";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import type { PredictionCategory } from "@/lib/enums";
import { isDigestEvent } from "@/lib/notificationDigest";
import { digestForViewer } from "@/lib/dailyDigests";

const PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const viewer = await getViewerEntitlement();

  const unread = await prisma.userNotification.count({ where: { userId, readAt: null } });
  if (req.nextUrl.searchParams.get("countOnly") === "1") return NextResponse.json({ unread });

  const cursor = req.nextUrl.searchParams.get("cursor") || undefined;
  const rows = await prisma.userNotification.findMany({
    where: { userId },
    include: { event: true },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const canView = (c: string) => canViewCategory(c as PredictionCategory, viewer.tier, viewer.status, viewer.role);
  const notifications = await Promise.all(rows.slice(0, PAGE_SIZE).map(async (n) => {
    // A digest is rendered for this viewer (audience, follows, entitlement),
    // and its data is never sent: it holds selections from every tier.
    if (isDigestEvent(n.event.type)) {
      const r = await digestForViewer(userId, n.event, canView);
      return { ...n, event: { ...n.event, title: r.title, body: r.body, link: r.link, data: null } };
    }
    const allowed = !n.event.category || canViewCategory(n.event.category as PredictionCategory, viewer.tier, viewer.status, viewer.role);
    return allowed ? n : { ...n, event: { ...n.event, body: "A followed tip has an update.", data: null } };
  }));
  return NextResponse.json({ notifications, nextCursor: rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1].id : null, unread });
}

const MarkRead = z.object({
  /** Omit to mark everything read. */
  ids: z.array(z.string().min(1).max(64)).max(100).optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = MarkRead.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
  const { ids } = parsed.data;
  const result = await prisma.userNotification.updateMany({
    where: { userId: session.user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true, updated: result.count });
}
