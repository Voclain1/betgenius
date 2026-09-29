import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { listTransactions } from "@/lib/paystack/paystack";
import { recordPaymentAttempt } from "@/lib/paystack/recordPaymentAttempt";
import { PAYMENT_CATEGORIES, type PaymentCategory } from "@/lib/paystack/failureCategory";
import {
  attemptOrigin,
  attemptOutcome,
  checkoutStage,
  lastMethodTried,
} from "@/lib/paystack/attemptDiagnosis";
import { applyCheckoutPayment } from "@/lib/paystack/applyCheckoutPayment";
import { planReconciliation } from "@/lib/paystack/reconcile";

/**
 * The payment-attempt log, for admins.
 *
 * GET returns the recorded attempts, each with how far the payer got (from
 * Paystack's session log), whether BetGenius started it, and whether it ended
 * in access. The counts are over BetGenius checkouts only: transactions on the
 * Paystack account that we never initialised — test probes, dashboard payment
 * pages — used to be counted as customer attempts, and were the only "paid"
 * one.
 *
 * POST with no body reconciles against Paystack. THIS IS NOT A RETRY. It lists
 * recent transactions read-only, records what it finds, and reports anything
 * Paystack says was paid that has no entitlement. It grants nothing.
 *
 * POST { reference, apply: true } is the one action that can grant: it runs
 * that single reference through applyCheckoutPayment, the webhook's own
 * verified path, which fetches Paystack's record and refuses anything that is
 * not a successful payment of the right amount, by the right customer, for
 * that tier, and never grants a reference twice.
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

  // Legacy grants predate the ledger and are recorded only in lastPaymentRef.
  const references = attempts.map((a) => a.reference);
  const legacyGranted = new Set(
    (
      await prisma.subscription.findMany({
        where: { lastPaymentRef: { in: references } },
        select: { lastPaymentRef: true },
      })
    ).map((s) => s.lastPaymentRef),
  );

  const rows = attempts.map((a) => {
    const origin = attemptOrigin(a.reference, a.userId);
    const entitled = !!a.entitlementGrantedAt || legacyGranted.has(a.reference);
    return {
      ...a,
      email: a.userId ? emailById.get(a.userId) ?? null : null,
      // A userId that matches no account is a test fixture or a deleted user.
      knownUser: a.userId ? emailById.has(a.userId) : false,
      origin,
      entitled,
      stage: checkoutStage(a),
      outcome: attemptOutcome({ category: a.category as PaymentCategory, origin, entitled }),
    };
  });
  const customer = rows.filter((r) => r.origin !== "EXTERNAL");

  const byCategory = Object.fromEntries(PAYMENT_CATEGORIES.map((c) => [c, 0])) as Record<string, number>;
  for (const r of customer) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;

  const byStage: Record<string, number> = {};
  for (const r of customer) byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;

  // Which method the payer actually chose — from Paystack's session log, not
  // Paystack's `channel`, which on an unpaid transaction is only a default.
  // A paid one uses its channel, which is then real.
  const byMethod: Record<string, { paid: number; notCompleted: number }> = {};
  for (const r of customer) {
    const key = r.category === "SUCCESS" ? r.channel ?? "unknown" : lastMethodTried(r.methodsTried) ?? "none chosen";
    byMethod[key] ??= { paid: 0, notCompleted: 0 };
    if (r.category === "SUCCESS") byMethod[key].paid += 1;
    else byMethod[key].notCompleted += 1;
  }

  return NextResponse.json({
    attempts: rows,
    byCategory,
    byStage,
    byMethod,
    excluded: rows.length - customer.length,
    entitlementMissing: rows.filter((r) => r.outcome === "ENTITLEMENT_MISSING").map((r) => r.reference),
  });
}

const Apply = z.object({ reference: z.string().min(1).max(200), apply: z.literal(true) });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (body && typeof body === "object" && "apply" in body) {
    const parsed = Apply.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "A reference and apply: true are required" }, { status: 400 });
    const result = await applyCheckoutPayment(parsed.data.reference, undefined, "RECONCILE");
    console.info("Admin payment reconcile applied", {
      reference: parsed.data.reference,
      outcome: result.outcome,
      admin: session!.user.id,
    });
    return NextResponse.json({ reference: parsed.data.reference, outcome: result.outcome });
  }

  let listed;
  try {
    listed = await listTransactions(100);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Paystack error";
    console.error("Payment reconcile failed", { code: "RECONCILE_FAILED", message });
    return NextResponse.json({ error: `Could not reach Paystack: ${message}` }, { status: 502 });
  }

  const transactions = listed.data ?? [];
  for (const transaction of transactions) {
    await recordPaymentAttempt(transaction, "RECONCILE");
  }
  const findings = await planReconciliation(transactions, prisma);

  return NextResponse.json({
    reconciled: transactions.length,
    findings: findings.filter((f) => f.action !== "NONE"),
  });
}
