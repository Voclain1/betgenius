import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { autoSelectBetOfTheDay, getBetOfTheDayCandidates } from "@/lib/betOfTheDay";
import { JOB_BET_OF_DAY_SELECT, recordJobRun } from "@/lib/jobRuns";

export const dynamic = "force-dynamic";

/** Same dual auth as the other scheduled endpoints: cron secret, or an admin session. */
async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const session = await getServerSession(authOptions);
  return isAdmin(session?.user.role);
}

/**
 * Run (or preview) the automatic Bet of the Day selection.
 *
 * `?dry=1` reports what WOULD be chosen, and why every other candidate was
 * rejected, without writing. That matters more here than for the other
 * curation jobs: this slot is one pick, chosen through a four-condition odds
 * gate, so "why isn't my pick the Bet of the Day" needs an answerable form
 * that doesn't involve changing the live slot to find out.
 */
export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  if (url.searchParams.get("dry") === "1") {
    const { eligible, rejected } = await getBetOfTheDayCandidates();
    return NextResponse.json({
      dryRun: true,
      wouldSelect: eligible[0] ?? null,
      eligible,
      // Reasons only — the full candidate rows would make this response large
      // and the rejection reason is the whole point of asking.
      rejected: rejected.map((r) => ({ id: r.id, match: `${r.homeTeam} v ${r.awayTeam}`, pick: r.pick, reasons: r.gate.reasons })),
    });
  }

  // Recorded because this is now a scheduled job, and "no acceptable pick today"
  // is a legitimate outcome that must be distinguishable from "the cron never
  // fired". Both leave the slot empty.
  const startedAt = Date.now();
  const result = await autoSelectBetOfTheDay();
  await recordJobRun({
    job: JOB_BET_OF_DAY_SELECT,
    ok: true,
    // `action` already distinguishes every outcome that matters — including
    // "kept" (the right pick was already tagged) and "skipped-manual-pin" (an
    // admin chose by hand), neither of which is a failure.
    summary: `${result.action}: ${result.consideredEligible} eligible, ${result.consideredRejected} rejected${result.detail ? ` — ${result.detail}` : ""}`,
    detail: result,
    ms: Date.now() - startedAt,
  });
  return NextResponse.json(result);
}
