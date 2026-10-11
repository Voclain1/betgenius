import { prisma } from "@/lib/prisma";
import { PLAN_PRICING, type PaidTier } from "@/lib/pricing";
import { grantPayment } from "@/lib/payments/grant";
import { manualReference, newManualCode } from "@/lib/payments/methods";
import { queueEmails, sendDue } from "@/lib/mail/outbox";
import { manualRejectedEmail, manualSubmittedAdminEmail, formatPaidAmount } from "@/lib/mail/templates";

/**
 * Bank transfer and USDT: money sent straight to our account or wallet.
 *
 * Nothing tells the site such a payment happened, so the flow is a request
 * the customer opens, pays against, and marks paid; an admin then checks the
 * bank app or the blockchain and approves or rejects it. Approval is the only
 * thing that grants access, and it goes through lib/payments/grant — the same
 * exactly-once path as every other payment, so a double-click cannot buy two
 * months and the receipt email follows automatically.
 *
 * The customer's "I've paid" is a claim, not proof. It only moves the request
 * into the admin's queue.
 */
export type ManualMethod = "BANK" | "USDT";

/** A request stays reusable this long, so refreshing the pricing page does not mint a new code each time. */
const REUSE_MS = 48 * 60 * 60_000;

export async function openManualPayment(userId: string, tier: PaidTier, method: ManualMethod) {
  const existing = await prisma.manualPayment.findFirst({
    where: { userId, tier, method, status: { in: ["AWAITING_PAYMENT", "SUBMITTED"] }, createdAt: { gte: new Date(Date.now() - REUSE_MS) } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = await prisma.manualPayment.create({
        data: {
          code: newManualCode(),
          userId,
          tier,
          method,
          amountNgn: PLAN_PRICING[tier].ngn,
          amountUsdCents: method === "USDT" ? Math.round(PLAN_PRICING[tier].usd * 100) : null,
        },
        select: { id: true },
      });
      return row.id;
    } catch (error) {
      // A code collision (one in hundreds of millions): draw again.
      if ((error as { code?: string } | null)?.code !== "P2002") throw error;
    }
  }
  throw new Error("Could not create a payment code");
}

export function manualAmountLabel(p: { method: string; amountNgn: number; amountUsdCents: number | null }): string {
  return p.method === "USDT" && p.amountUsdCents != null ? formatPaidAmount(p.amountUsdCents, "USDT") : formatPaidAmount(p.amountNgn * 100, "NGN");
}

/** The customer says they have paid. Moves the request to the admin queue and tells every admin. */
export async function submitManualPayment(id: string, userId: string, payerDetails: string) {
  const row = await prisma.manualPayment.findUnique({ where: { id }, include: { user: { select: { email: true } } } });
  if (!row || row.userId !== userId) return { ok: false as const, error: "NOT_FOUND" };
  if (row.status !== "AWAITING_PAYMENT" && row.status !== "SUBMITTED") return { ok: false as const, error: "CLOSED" };
  await prisma.manualPayment.update({ where: { id }, data: { status: "SUBMITTED", payerDetails, submittedAt: new Date() } });

  // First submission only: a corrected hash or name should not page the admins twice.
  if (row.status === "AWAITING_PAYMENT") {
    const admins = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } }, select: { id: true, email: true } });
    const email = manualSubmittedAdminEmail({
      code: row.code,
      method: row.method,
      tier: row.tier,
      amount: manualAmountLabel(row),
      customerEmail: row.user.email,
      payerDetails,
    });
    await queueEmails(admins.map((a) => ({ key: `manual-submitted:${row.id}:${a.id}`, kind: "ADMIN_ALERT", userId: a.id, to: a.email, email })));
    // Best effort now; the dispatch cron sends anything left within minutes.
    await sendDue({ deadline: Date.now() + 8_000, limit: admins.length }).catch(() => null);
  }
  return { ok: true as const };
}

export async function approveManualPayment(id: string, adminId: string) {
  const row = await prisma.manualPayment.findUnique({ where: { id } });
  if (!row) return { ok: false as const, error: "NOT_FOUND" };
  if (row.status === "APPROVED") return { ok: true as const, already: true };
  if (row.status === "REJECTED") return { ok: false as const, error: "Already rejected" };
  const tier = row.tier as PaidTier;
  const usdt = row.method === "USDT";
  const result = await grantPayment({
    reference: manualReference(row.code),
    provider: usdt ? "USDT" : "BANK",
    userId: row.userId,
    tier,
    amountMinor: usdt ? row.amountUsdCents ?? 0 : row.amountNgn * 100,
    currency: usdt ? "USDT" : "NGN",
    channel: usdt ? "usdt" : "bank_transfer_direct",
    occurredAt: row.submittedAt ?? new Date(),
    source: "ADMIN",
  });
  await prisma.manualPayment.update({ where: { id }, data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: adminId } });
  console.info("Manual payment approved", { id, code: row.code, method: row.method, outcome: result.outcome });
  return { ok: true as const, already: result.outcome === "ALREADY_GRANTED" };
}

export async function rejectManualPayment(id: string, adminId: string, reason: string) {
  const row = await prisma.manualPayment.findUnique({ where: { id }, include: { user: { select: { email: true } } } });
  if (!row) return { ok: false as const, error: "NOT_FOUND" };
  if (row.status === "APPROVED") return { ok: false as const, error: "Already approved" };
  await prisma.manualPayment.update({ where: { id }, data: { status: "REJECTED", reviewedAt: new Date(), reviewedById: adminId, rejectReason: reason || null } });
  await queueEmails([
    {
      key: `manual-rejected:${row.id}`,
      kind: "PAYMENT_PROBLEM",
      userId: row.userId,
      to: row.user.email,
      email: manualRejectedEmail({ code: row.code, method: row.method, tier: row.tier as PaidTier, reason }),
    },
  ]);
  return { ok: true as const };
}
