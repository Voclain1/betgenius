import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/seo";
import { unsubscribeToken, type UnsubscribeKind } from "@/lib/mail/unsubscribe";
import type { RenderedEmail } from "@/lib/mail/templates";

/**
 * The email outbox.
 *
 * Every email is queued as an EmailMessage row first and sent from there, so:
 *
 *   - IT IS SENT ONCE. Each row has a unique `key` that names the thing it is
 *     about (a payment reference, a user and a date). Queueing the same key
 *     twice is a no-op, so a job that runs every two minutes can keep asking
 *     "should this person get a receipt?" without sending a second one.
 *   - A FAILED SEND IS RETRIED, with backoff, and given up on after
 *     MAX_ATTEMPTS — the row then says why.
 *   - THE ADMIN CAN SEE WHAT HAPPENED. The row is the log.
 *
 * Optional kinds (daily picks, announcements) are re-checked against the
 * person's preference at SEND time, not just at queue time, so an unsubscribe
 * that lands between the two still wins.
 */
export type EmailKind =
  | "RECEIPT"
  | "PAYMENT_PROBLEM"
  | "RENEWAL_REMINDER"
  | "ACCESS_ENDED"
  | "DAILY_PICKS"
  | "ANNOUNCEMENT"
  | "ADMIN_ALERT";

export const MAX_ATTEMPTS = 5;
/** Resend's default limit is 2 requests a second; this stays under it. */
const SEND_SPACING_MS = 600;
const LEASE_MS = 5 * 60_000;

export type QueueInput = {
  key: string;
  kind: EmailKind;
  userId: string;
  to: string;
  email: RenderedEmail;
  unsubscribeKind?: UnsubscribeKind | null;
  campaignId?: string | null;
  expiresAt?: Date | null;
};

/** The page a person lands on from the link in the email. */
export function unsubscribeUrl(userId: string, kind: UnsubscribeKind): string {
  return `${SITE_URL}/email/unsubscribe?t=${encodeURIComponent(unsubscribeToken(userId, kind))}`;
}

/** Where a mail app's own Unsubscribe button POSTs (RFC 8058). */
export function oneClickUnsubscribeUrl(userId: string, kind: UnsubscribeKind): string {
  return `${SITE_URL}/api/email/unsubscribe?t=${encodeURIComponent(unsubscribeToken(userId, kind))}`;
}

/** Queue many at once. Returns how many were new; existing keys are left untouched. */
export async function queueEmails(inputs: QueueInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const result = await prisma.emailMessage.createMany({
    data: inputs.map((i) => ({
      key: i.key,
      kind: i.kind,
      userId: i.userId,
      to: i.to,
      subject: i.email.subject,
      html: i.email.html,
      text: i.email.text,
      unsubscribeKind: i.unsubscribeKind ?? null,
      campaignId: i.campaignId ?? null,
      expiresAt: i.expiresAt ?? null,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/** Which keys already exist, so a producer can skip the work of rendering them. */
export async function existingKeys(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await prisma.emailMessage.findMany({ where: { key: { in: keys } }, select: { key: true } });
  return new Set(rows.map((r) => r.key));
}

/** Retry delay after the nth failed attempt: 2, 4, 8, 16 minutes. */
export function retryDelayMs(attempts: number): number {
  return 2 ** Math.max(1, attempts) * 60_000;
}

export type SendSummary = { sent: number; failed: number; retried: number; skipped: number; expired: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send what is due, until `deadline` or `limit`. Safe to run concurrently: each
 * row is claimed with a lease before it is sent, so two overlapping runs never
 * send the same row.
 */
export async function sendDue(opts: { deadline: number; limit?: number; ids?: string[]; now?: Date }): Promise<SendSummary> {
  const now = opts.now ?? new Date();
  const summary: SendSummary = { sent: 0, failed: 0, retried: 0, skipped: 0, expired: 0 };

  // Anything past its expiry is dropped, not sent late.
  const dropped = await prisma.emailMessage.updateMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    data: { status: "SKIPPED", lastError: "EXPIRED" },
  });
  summary.expired = dropped.count;

  const due = await prisma.emailMessage.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: now },
      OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
      ...(opts.ids ? { id: { in: opts.ids } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 40,
  });

  let first = true;
  for (const message of due) {
    if (Date.now() > opts.deadline) break;
    const claimed = await prisma.emailMessage.updateMany({
      where: { id: message.id, status: "PENDING", OR: [{ leasedUntil: null }, { leasedUntil: { lt: new Date() } }] },
      data: { leasedUntil: new Date(Date.now() + LEASE_MS), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;
    const attempts = message.attempts + 1;

    if (message.unsubscribeKind && !(await stillWanted(message.userId, message.unsubscribeKind as UnsubscribeKind))) {
      await prisma.emailMessage.update({ where: { id: message.id }, data: { status: "SKIPPED", lastError: "UNSUBSCRIBED", leasedUntil: null } });
      summary.skipped++;
      continue;
    }

    if (!first) await sleep(SEND_SPACING_MS);
    first = false;

    // RFC 8058 one-click: mail apps show their own Unsubscribe button and POST
    // to this URL. The API route accepts it without a session.
    const headers = message.unsubscribeKind
      ? {
          "List-Unsubscribe": `<${oneClickUnsubscribeUrl(message.userId, message.unsubscribeKind as UnsubscribeKind)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
      : undefined;

    const result = await sendEmail({ to: message.to, subject: message.subject, html: message.html, text: message.text, headers });
    if (result.delivered) {
      await prisma.emailMessage.update({ where: { id: message.id }, data: { status: "SENT", sentAt: new Date(), lastError: null, leasedUntil: null } });
      summary.sent++;
    } else if (attempts >= MAX_ATTEMPTS) {
      await prisma.emailMessage.update({ where: { id: message.id }, data: { status: "FAILED", lastError: (result.reason ?? "unknown").slice(0, 300), leasedUntil: null } });
      summary.failed++;
    } else {
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: { lastError: (result.reason ?? "unknown").slice(0, 300), nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)), leasedUntil: null },
      });
      summary.retried++;
    }
  }
  return summary;
}

async function stillWanted(userId: string, kind: UnsubscribeKind): Promise<boolean> {
  const pref = await prisma.emailPreference.findUnique({ where: { userId }, select: { dailyPicks: true, announcements: true } });
  return pref ? pref[kind] : true;
}
