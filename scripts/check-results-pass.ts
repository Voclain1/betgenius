/**
 * Results land minutes after the final whistle: the 10-minute results pass
 * (src/lib/resultsPass.ts) and the settlement rules it shares with the full
 * run (src/lib/settleFinished.ts). Pure, no database.
 *
 * Run: npx tsx scripts/check-results-pass.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldAbandon, SETTLEMENT_BUFFER_MS, SETTLEMENT_MAX_ATTEMPTS } from "../src/lib/settleFinished";
import { RESULTS_PASS_POLICY } from "../src/lib/resultsPass";
import { JOB_RESULTS_PASS, KNOWN_JOBS } from "../src/lib/jobRuns";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}
const read = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
const H = 3_600_000;
const now = Date.UTC(2026, 9, 17, 22, 0);
const ago = (hours: number) => new Date(now - hours * H);

// Timing.
check("a pick is first checked 1h50m after kickoff (was 2.5h)", SETTLEMENT_BUFFER_MS === 110 * 60_000, SETTLEMENT_BUFFER_MS);
check("the results pass runs every 10 minutes", RESULTS_PASS_POLICY.INTERVAL_MINUTES === 10);

// Abandonment can no longer happen within minutes of the whistle.
check("3 failed lookups 30 minutes after the match: keep trying", !shouldAbandon(SETTLEMENT_MAX_ATTEMPTS, ago(2.5), now));
check("3 failed lookups, kickoff 9h ago: hand to an admin", shouldAbandon(SETTLEMENT_MAX_ATTEMPTS, ago(9), now));
check("2 failed lookups, kickoff 9h ago: keep trying", !shouldAbandon(2, ago(9), now));
check("past 72h: hand to an admin whatever the count", shouldAbandon(0, ago(73), now));
check("no kickoff and 3 failures: hand to an admin (as before)", shouldAbandon(SETTLEMENT_MAX_ATTEMPTS, null, now));

// A pick is settled once even when the pass and the full run overlap.
const lib = read("src/lib/settleFinished.ts");
check("settle write is conditional on outcome PENDING", /updateMany\(\{ where: \{ id: p\.id, outcome: "PENDING" \}/.test(lib));
check("...and sends no notification when it lost the race", /if \(claimed\.count === 0\) return false;/.test(lib));

// Both runs share the one settling routine.
check("full run uses settleFinishedPredictions", /settleFinishedPredictions\(limit\)/.test(read("src/app/api/admin/settle/route.ts")));
const pass = read("src/lib/resultsPass.ts");
check("results pass uses settleFinishedPredictions and settles doubles", /settleFinishedPredictions\(RESULTS_PASS_POLICY\.LIMIT\)/.test(pass) && /settleSameGameDoubles\(\)/.test(pass));
check("results pass is leased in AppLock", /INSERT INTO "AppLock"/.test(pass) && /WHERE "AppLock"\."expiresAt" <= /.test(pass));

// Riding the 2-minute dispatch cron, before push dispatch.
const dispatch = read("src/app/api/admin/notifications/dispatch/route.ts");
const iPass = dispatch.indexOf("runResultsPass()");
const iPush = dispatch.indexOf("runNotificationDispatch()");
check("dispatch runs the results pass before push", iPass > 0 && iPush > iPass);
check("a failed results pass never blocks dispatch", /runResultsPass\(\)\.catch\(/.test(dispatch));
check("dispatch has room for it (maxDuration 120)", /export const maxDuration = 120;/.test(dispatch));
check("results-pass is a known job", JOB_RESULTS_PASS === "results-pass" && (KNOWN_JOBS as readonly string[]).includes(JOB_RESULTS_PASS));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll results pass checks passed");
