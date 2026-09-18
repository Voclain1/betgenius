import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { listTransactions } from "@/lib/paystack/paystack";
import { recordPaymentAttempt } from "@/lib/paystack/recordPaymentAttempt";
import { PAYMENT_CATEGORIES } from "@/lib/paystack/failureCategory";

/**
 * The payment-attempt log, for admins.
 *
 * GET returns the recorded attempts plus a count per category, which is the
 * question actually being asked right now: is anybody able to pay, and when
 * they cannot, whose problem is it?
 *
 * POST reconciles against Paystack. THIS IS NOT A RETRY. It lists recent
 * transactions read-only and records what it finds; it never re-initializes or
 * re-charges anything, and it cannot, because the client exposes no way to.
 * It exists because an abandoned checkout produces no webhook and no callback
 * — the payer closed the tab — so without pulling the list, the single most
 * common failure is the one we would never see.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const attempts = await prisma.paymentAttempt.findMany({
    orderBy: { occurredAt: "desc" },
    take: 200,
  });

  // Emails are resolved for display and are NOT stored on the attempt row —
  // the row keeps a userId. One query, not one per row.
  const userIds = Array.from(new Set(attempts.map((a) => a.userId).filter((id): id is string => !!id)));
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
    : [];
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  const byCategory = Object.fromEntries(PAYMENT_CATEGORIES.map((c) => [c, 0])) as Record<string, number>;
  for (const a of attempts) byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;

  // Which channels actually complete. This is the evidence we are collecting
  // before touching the channel configuration — not a reason to change it yet.
  const byChannel: Record<string, { paid: number; failed: number }> = {};
  for (const a of attempts) {
    const key = a.channel ?? "unknown";
    byChannel[key] ??= { paid: 0, failed: 0 };
    if (a.category === "SUCCESS") byChannel[key].paid += 1;
    else byChannel[key].failed += 1;
  }

  return NextResponse.json({
    attempts: attempts.map((a) => ({ ...a, email: a.userId ? emailById.get(a.userId) ?? null : null })),
    byCategory,
    byChannel,
  });
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let listed;
  try {
    listed = await listTransactions(100);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Paystack error";
    console.error("Payment reconcile failed", { code: "RECONCILE_FAILED", message });
    return NextResponse.json({ error: `Could not reach Paystack: ${message}` }, { status: 502 });
  }

  for (const transaction of listed.data ?? []) {
    await recordPaymentAttempt(transaction, "RECONCILE");
  }

  return NextResponse.json({ reconciled: (listed.data ?? []).length });
}
