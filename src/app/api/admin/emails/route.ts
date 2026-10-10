import { randomUUID } from "node:crypto";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
import { AUDIENCES, audienceRecipients, createCampaign, type Audience } from "@/lib/mail/campaigns";
import { queueEmails, sendDue, unsubscribeUrl } from "@/lib/mail/outbox";
import { announcementEmail } from "@/lib/mail/templates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET: what the admin Email page shows — whether sending is configured, how
 * many people each audience reaches, past announcements, and the last week of
 * automatic email by kind and outcome.
 *
 * POST { action: "test" }: renders the announcement exactly as recipients
 * will get it and sends it to the signed-in admin only, now.
 * POST { action: "send" }: queues it for the chosen audience and starts
 * sending; the 2-minute dispatch cron finishes the rest.
 */
async function admin() {
  const session = await getServerSession(authOptions);
  return isAdmin(session?.user.role) ? session!.user : null;
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const [audiences, campaigns, byKind, failures] = await Promise.all([
    Promise.all((Object.keys(AUDIENCES) as Audience[]).map(async (a) => ({ id: a, label: AUDIENCES[a], count: (await audienceRecipients(a)).length }))),
    prisma.emailCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.emailMessage.groupBy({ by: ["kind", "status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.emailMessage.findMany({
      where: { status: "FAILED", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, kind: true, to: true, subject: true, lastError: true, createdAt: true },
    }),
  ]);
  const campaignStatus = campaigns.length
    ? await prisma.emailMessage.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: campaigns.map((c) => c.id) } }, _count: { _all: true } })
    : [];
  return NextResponse.json({
    configured: !!process.env.RESEND_API_KEY,
    audiences,
    campaigns: campaigns.map((c) => ({
      ...c,
      status: Object.fromEntries(campaignStatus.filter((s) => s.campaignId === c.id).map((s) => [s.status, s._count._all])),
    })),
    byKind: byKind.map((k) => ({ kind: k.kind, status: k.status, count: k._count._all })),
    failures,
  });
}

const Body = z.object({
  action: z.enum(["test", "send"]),
  subject: z.string().trim().min(3).max(150),
  body: z.string().trim().min(1).max(10_000),
  audience: z.enum(Object.keys(AUDIENCES) as [Audience, ...Audience[]]),
});

export async function POST(req: NextRequest) {
  const user = await admin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "Email sending is not set up: RESEND_API_KEY is missing." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A subject (3–150 characters), a message and an audience are required." }, { status: 400 });
  const { action, subject, body, audience } = parsed.data;
  const deadline = Date.now() + 40_000;

  if (action === "test") {
    const key = `campaign-test:${user.id}:${randomUUID()}`;
    await queueEmails([
      {
        key,
        kind: "ANNOUNCEMENT",
        userId: user.id,
        to: user.email!,
        // The real unsubscribe link, so the test shows exactly what goes out.
        email: announcementEmail({ subject: `[Test] ${subject}`, body, unsubscribeUrl: unsubscribeUrl(user.id, "announcements") }),
      },
    ]);
    const row = await prisma.emailMessage.findUnique({ where: { key }, select: { id: true } });
    const result = await sendDue({ deadline, ids: row ? [row.id] : [] });
    return NextResponse.json({ test: true, to: user.email, delivered: result.sent === 1 });
  }

  const campaign = await createCampaign({ subject, body, audience, adminId: user.id });
  console.info("Admin announcement queued", { campaignId: campaign.id, audience, queued: campaign.queued });
  const result = await sendDue({ deadline });
  return NextResponse.json({ campaign, sentNow: result.sent });
}
