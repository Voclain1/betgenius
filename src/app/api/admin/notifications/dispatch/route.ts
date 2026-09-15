import { NextRequest, NextResponse } from "next/server";
import { withJobRun } from "@/lib/jobRuns";
import { runNotificationDispatch } from "@/lib/notificationDispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest) {
  return !!process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await withJobRun(
    "notifications-dispatch",
    () => runNotificationDispatch(),
    (r) => `events ${r.events}, claimed ${r.claimed}, delivered ${r.delivered}, retried ${r.retried}, skipped ${r.skipped}, deferred ${r.deferred}, lost leases ${r.lostLeases}`,
  );
  return NextResponse.json(result);
}
