import { NextRequest, NextResponse } from "next/server";
import { JOB_EMAIL_DISPATCH, JOB_NOTIFICATIONS_DISPATCH, withJobRun } from "@/lib/jobRuns";
import { runNotificationDispatch } from "@/lib/notificationDispatch";
import { runEmailDispatch, summariseEmailDispatch } from "@/lib/mail/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest) {
  return !!process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Push first, then email, in the same request: email rides this schedule
  // rather than needing a scheduler entry of its own. Each is recorded as its
  // own job, and a push failure does not stop email (or the reverse) — the
  // push error is re-thrown afterwards so the cron still sees it.
  let result: Awaited<ReturnType<typeof runNotificationDispatch>> | null = null;
  let pushError: unknown = null;
  try {
    result = await withJobRun(
      JOB_NOTIFICATIONS_DISPATCH,
      () => runNotificationDispatch(),
      (r) => `events ${r.events}, claimed ${r.claimed}, delivered ${r.delivered}, retried ${r.retried}, skipped ${r.skipped}, deferred ${r.deferred}, lost leases ${r.lostLeases}`,
    );
  } catch (error) {
    pushError = error;
  }
  const email = await withJobRun(JOB_EMAIL_DISPATCH, () => runEmailDispatch({ budgetMs: 20_000 }), summariseEmailDispatch).catch(
    (error: unknown) => ({ ran: false as const, reason: error instanceof Error ? error.message : String(error) }),
  );
  if (pushError) throw pushError;
  return NextResponse.json({ ...result, email });
}
