import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { getAccountStatus } from "@/lib/football/api-football";
import { getUsageSnapshot, reconcileWithAccount, utcDay } from "@/lib/football/usage";

export const dynamic = "force-dynamic";

/**
 * api-football quota dashboard: what this app has spent today (per endpoint),
 * checked against what the account itself reports.
 *
 * `?live=0` skips the /status probe and answers from local counts alone — worth
 * having because /status is itself rate-limited, so a polling UI shouldn't be
 * forced to spend a request on every refresh.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const live = new URL(req.url).searchParams.get("live") !== "0";
  const day = utcDay();

  let account: Awaited<ReturnType<typeof getAccountStatus>> = null;
  let adjusted = 0;
  if (live) {
    account = await getAccountStatus();
    // Correct local drift upward before snapshotting, so `remaining` reflects
    // the account's real spend rather than only what this app tracked.
    if (account) adjusted = (await reconcileWithAccount(account.requests.current, day)).adjusted;
  }

  const usage = await getUsageSnapshot(day);

  return NextResponse.json({
    usage,
    reconciledBy: adjusted,
    account: account
      ? {
          email: account.account.email ?? null,
          plan: account.subscription.plan,
          active: account.subscription.active,
          renewsOrEndsAt: account.subscription.end,
          accountCurrent: account.requests.current,
          accountLimitDay: account.requests.limit_day,
        }
      : null,
  });
}
