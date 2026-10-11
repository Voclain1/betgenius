import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { manualAmountLabel } from "@/lib/payments/manual";

export const dynamic = "force-dynamic";

/** Bank / USDT requests: those waiting for review first, then the last 50 of everything. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await prisma.manualPayment.findMany({
    orderBy: [{ submittedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 80,
    include: { user: { select: { email: true } } },
  });
  const order = (s: string) => (s === "SUBMITTED" ? 0 : s === "AWAITING_PAYMENT" ? 1 : 2);
  const sorted = [...rows].sort((a, b) => order(a.status) - order(b.status));
  return NextResponse.json({
    payments: sorted.map((r) => ({
      id: r.id,
      code: r.code,
      email: r.user.email,
      tier: r.tier,
      method: r.method,
      amount: manualAmountLabel(r),
      payerDetails: r.payerDetails,
      status: r.status,
      createdAt: r.createdAt,
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
      rejectReason: r.rejectReason,
    })),
  });
}
