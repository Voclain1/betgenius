import { prisma } from "@/lib/prisma";
import { settleFinishedPredictions } from "@/lib/settleFinished";
import { settleSameGameDoubles } from "@/lib/sameGameDoubleAssembly";

/**
 * Results within minutes of the final whistle, not hours.
 *
 * THE PROBLEM. Picks were settled only by the full settlement run, every 3
 * hours (cron-job.org), and only once kickoff was 2.5h old. Production,
 * October 2026: a median of 4.0 hours from kickoff to a result on the site
 * (p90 6.0h), so about 2 hours after the match had ended, and up to 4.
 *
 * THE FIX. This pass rides the notifications dispatch cron, which already
 * fires every 2 minutes, and runs at most once per RESULTS_PASS_POLICY
 * .INTERVAL_MINUTES (an AppLock lease, so overlapping requests cannot both
 * run it). It does only the settling: finished picks, then same-game doubles
 * from their legs. Curation and the upcoming-kickoff check stay on the full
 * 3-hourly run, which also settles anything this pass left over.
 *
 * Running it before push dispatch means a result notification goes out in the
 * same request that settled the pick.
 *
 * COST. Picks with a fixture id are looked up 20 per provider call
 * (prefetchFixturesById), so a pass is usually one call, and none when
 * nothing is due.
 */
export const RESULTS_PASS_POLICY = {
  INTERVAL_MINUTES: 10,
  /** Per pass. Small, because the dispatch request it shares has a 120 s ceiling. */
  LIMIT: 25,
} as const;

export const RESULTS_PASS_LOCK_KEY = "results-pass";

/** Wins the lease for this interval, or returns false when another request holds it. */
async function claimResultsPass(now: Date): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + RESULTS_PASS_POLICY.INTERVAL_MINUTES * 60_000);
  const rows = await prisma.$queryRaw<Array<{ key: string }>>`
    INSERT INTO "AppLock" ("key", "holder", "acquiredAt", "expiresAt")
    VALUES (${RESULTS_PASS_LOCK_KEY}, ${"results-pass"}, ${now}, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE
      SET "acquiredAt" = EXCLUDED."acquiredAt", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "AppLock"."expiresAt" <= ${now}
    RETURNING "key"
  `;
  return rows.length > 0;
}

export type ResultsPassOutcome =
  | { ran: false }
  | { ran: true; checked: number; settled: number; doublesSettled: number };

export async function runResultsPass(now: Date = new Date()): Promise<ResultsPassOutcome> {
  if (!(await claimResultsPass(now))) return { ran: false };
  const { checked, results } = await settleFinishedPredictions(RESULTS_PASS_POLICY.LIMIT);
  const doubles = await settleSameGameDoubles();
  const isResult = (r: { result: string }) => ["WON", "LOST", "VOID"].includes(r.result);
  return { ran: true, checked, settled: results.filter(isResult).length, doublesSettled: doubles.filter(isResult).length };
}
