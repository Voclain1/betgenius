import { prisma } from "@/lib/prisma";
import { queueEmails, unsubscribeUrl, type QueueInput } from "@/lib/mail/outbox";
import { announcementEmail } from "@/lib/mail/templates";

/**
 * Announcements: an admin writes a subject and a plain-text body and picks who
 * gets it. Sending queues one EmailMessage per recipient and the dispatcher
 * sends them in the background, so a large audience never has to fit in one
 * request.
 *
 * AUDIENCES ARE PEOPLE WHO HAVE PAID. Everyone here bought a plan, so an
 * announcement about the service they paid for is expected, and every one
 * carries an unsubscribe link that is honoured at send time. Free accounts are
 * deliberately not an audience: they never agreed to marketing email, and a
 * column default cannot agree on their behalf.
 */
export const AUDIENCES = {
  ALL_PAID: "Everyone with active VIP or Premium",
  VIP: "Active VIP",
  PREMIUM: "Active Premium",
  LAPSED: "Former subscribers whose access has ended",
  DIRECT: "Specific people (paste their email addresses)",
} as const;
export type Audience = keyof typeof AUDIENCES;

/**
 * DIRECT is one-to-one correspondence, not a broadcast: a message to a named
 * customer, e.g. about their own failed payment. It goes only to registered
 * accounts (every email row belongs to a user), at most DIRECT_MAX at a time,
 * and carries no unsubscribe link, like any other message about someone's
 * own account. Anything sent to many people belongs in the other audiences,
 * where unsubscribes are honoured.
 */
export const DIRECT_MAX = 20;

/** Pasted text → distinct, lower-cased addresses (comma, space, semicolon or newline separated). */
export function parseEmailList(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

export async function directRecipients(emails: string[]): Promise<{ found: { id: string; email: string }[]; notFound: string[] }> {
  const found = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
  const have = new Set(found.map((u) => u.email.toLowerCase()));
  return { found, notFound: emails.filter((e) => !have.has(e)) };
}

export function isAudience(value: unknown): value is Audience {
  return typeof value === "string" && value in AUDIENCES;
}

export async function audienceRecipients(audience: Audience, now: Date = new Date()): Promise<{ id: string; email: string }[]> {
  if (audience === "DIRECT") return [];
  const live = { status: "ACTIVE", OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }] };
  const subscription =
    audience === "VIP"
      ? { tier: "VIP", ...live }
      : audience === "PREMIUM"
        ? { tier: "PREMIUM", ...live }
        : audience === "ALL_PAID"
          ? { tier: { in: ["VIP", "PREMIUM"] }, ...live }
          : {
              // Paid at some point (a payment or an admin approval on record),
              // and without access now.
              tier: { in: ["VIP", "PREMIUM"] },
              OR: [{ lastPaymentRef: { not: null } }, { approvedAt: { not: null } }],
              NOT: live,
            };
  return prisma.user.findMany({
    where: { subscription, NOT: { emailPreference: { announcements: false } } },
    select: { id: true, email: true },
  });
}

export async function createCampaign(input: {
  subject: string;
  body: string;
  audience: Audience;
  adminId: string;
  /** DIRECT only: the accounts to write to, already resolved by directRecipients. */
  direct?: { id: string; email: string }[];
}) {
  const direct = input.audience === "DIRECT";
  const recipients = direct ? (input.direct ?? []).slice(0, DIRECT_MAX) : await audienceRecipients(input.audience);
  const campaign = await prisma.emailCampaign.create({
    data: { subject: input.subject, body: input.body, audience: input.audience, createdById: input.adminId, queued: 0 },
  });
  const queue: QueueInput[] = recipients.map((r) => ({
    key: `campaign:${campaign.id}:${r.id}`,
    kind: "ANNOUNCEMENT",
    userId: r.id,
    to: r.email,
    campaignId: campaign.id,
    unsubscribeKind: direct ? null : "announcements",
    email: announcementEmail({ subject: input.subject, body: input.body, unsubscribeUrl: direct ? null : unsubscribeUrl(r.id, "announcements") }),
  }));
  const queued = await queueEmails(queue);
  await prisma.emailCampaign.update({ where: { id: campaign.id }, data: { queued } });
  return { id: campaign.id, queued };
}
