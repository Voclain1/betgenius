import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { settleFinishedPredictions } from "@/lib/settleFinished";
import { reconcileUpcomingKickoffs } from "@/lib/kickoffReconcile";
import { curateAutomaticTips } from "@/lib/geniusCuration";
import { settleSameGameDoubles } from "@/lib/sameGameDoubleAssembly";
import { JOB_SETTLE, withJobRun } from "@/lib/jobRuns";

// Bulk settlement runs sequentially through the throttled api-football queue
// (up to 2 calls per prediction) — bound generously since Vercel Cron (and
// this route) invoke via a single request with no retry-on-timeout.
//
// MEASURED WALL-CLOCK, from five production-safe samples at each size:
//
//     40 items  ->  42.58 - 51.07s
//     18 items  ->  18.80 - 20.67s
//
// So throughput is roughly one item per second, and a full 40-item batch runs
// two to three times longer than the 30-second point at which cron-job.org —
// which drives the 3-hourly runs — closes its side of the connection.
//
// THAT DISCONNECT DOES NOT ABORT THE RUN. Vercel executes to completion up to
// maxDuration regardless of whether the caller is still listening, and the
// production record confirms it: across 12 days, 15 of 55 runs settled 40 or
// more items, four of them landing on exactly 40. A run cut off at 30s could
// not reach the full batch — and because settlement writes its results in one
// burst at the END, a truncated run would write nothing at all rather than a
// partial batch. There is no clustering around the ~18 items that 30 seconds
// buys; the only ceiling in the distribution is the configured limit below.
//
// This is recorded because the question was expensive to answer from outside
// and will be asked again. JobRun now stores per-run wall-clock (see the
// withJobRun wrapper below), so next time it is a lookup rather than an
// inference from these numbers.
export const maxDuration = 300;
export const dynamic = "force-dynamic";
async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const session = await getServerSession(authOptions);
  return isAdmin(session?.user.role);
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Recorded AFTER the auth gate, so a rejected probe never lands in the run
  // history — the history answers "did the scheduled job run", and a 403 is
  // not a run.
  const payload = await withJobRun(JOB_SETTLE, () => runSettlement(req), summariseSettlement);
  return NextResponse.json(payload);
}

/** One line per run: what it got through, and how much was left on the table. */
function summariseSettlement(r: Awaited<ReturnType<typeof runSettlement>>): string {
  return `checked ${r.checked}, settled ${r.settled}, doubles ${r.doublesSettled}/${r.doublesChecked}, limit ${r.limit}`;
}

async function runSettlement(req: Request) {
  const url = new URL(req.url);
  const curation = await curateAutomaticTips();
  // Raised from 15/30. Settlement has to keep pace with whatever publication
  // rate the reviewer sustains, and at up to 100 predictions a day a daily run
  // of 15 would fall permanently and increasingly behind.
  //
  // Sized for 8 runs a day (3-hourly, via cron-job.org — this plan's own crons
  // are capped at once daily): 8 x 40 = 320/day against a 100/day ceiling, so a
  // missed run self-heals rather than compounding. 40 predictions costs ~80
  // throttled calls, roughly 60-90s, well inside maxDuration=300.
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit")) || 40));

  const { checked, results, kickoffsReconciled, fixtureIdsPrefetched } = await settleFinishedPredictions(limit);

  // UPCOMING-KICKOFF PASS. Settlement's own reconciliation only fires when a
  // finished fixture resolves, i.e. after the match — too late for anyone
  // reading the pick beforehand. This corrects rows that are still ahead of us,
  // riding the same 3-hourly schedule so it needs no cron of its own.
  const upcoming = await reconcileUpcomingKickoffs();

  // SECOND PASS — same-game doubles, settled from their legs rather than from
  // a scoreline. Runs after the loop above because those legs may have been
  // settled seconds ago in this very request. See settleSameGameDoubles.
  const doubleResults = await settleSameGameDoubles();

  return {
    // Echoed so a recorded run states the batch size it actually used — the
    // limit is overridable by query string, and a history that omitted it
    // could not distinguish a small run from a small batch.
    limit,
    curation,
    checked,
    settled: results.filter((r) => ["WON", "LOST", "VOID"].includes(r.result)).length,
    abandoned: results.filter((r) => r.result === "abandoned").length,
    kickoffsReconciled,
    fixtureIdsPrefetched,
    upcomingKickoffs: {
      checked: upcoming.checked,
      fixturesFetched: upcoming.fixturesFetched,
      updated: upcoming.updated,
      changes: upcoming.changes,
    },
    results,
    doublesChecked: doubleResults.length,
    doublesSettled: doubleResults.filter((r) => ["WON", "LOST", "VOID"].includes(r.result)).length,
    doubleResults,
  };
}
