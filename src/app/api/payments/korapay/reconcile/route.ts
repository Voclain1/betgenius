import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { enabledMethods } from "@/lib/payments/methods";
import { sweepKorapay } from "@/lib/payments/korapay";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Scheduled missed-webhook recovery for Korapay (deploy/ops/crontab, every 10
 * minutes). Re-checks recent pending Korapay checkouts with Korapay and grants
 * the paid ones through the webhook's own verified path (sweepKorapay).
 * CRON_SECRET bearer, or a signed-in admin.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const cron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron) {
    const session = await getServerSession(authOptions);
    if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!enabledMethods().includes("KORAPAY")) return NextResponse.json({ skipped: "Korapay is not configured" });
  return NextResponse.json(await sweepKorapay());
}
