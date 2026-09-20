/**
 * Proves the enrichment workload response is bounded no matter how large the
 * run is.
 *
 * THE FAILURE THIS LOCKS OUT. cron-job.org disabled the fixture-details job
 * after 27 consecutive "Failed (output too large)" results. The job was healthy
 * every time — HTTP 200, 2,082 successful cache attempts in 24h, 13 legitimate
 * slate misses, zero provider errors — and the scheduler still gave up, because
 * the response body grew with the size of the run. A controlled limit=1 request
 * returned 200 and a small body, which is precisely why this needs a test: the
 * endpoint looks fine at every size anyone probes by hand, and only fails at the
 * size the cron actually uses.
 *
 * So the assertions below are about the SHAPE OF THE GROWTH, not about one
 * example. A ten-thousand-row run is serialised here and measured; if the
 * response ever starts scaling with the workload again, the byte assertions
 * fail long before a scheduler notices.
 *
 * Pure — no database, no football API. The reports are synthetic, which is the
 * only way to assert the large-run case at all.
 *
 * Run: npx tsx scripts/check-enrichment-report.ts
 */
import {
  WORKLOAD_DETAIL_MAX,
  WORKLOAD_SAMPLE_LIMIT,
  toCompactWorkloadReport,
  type WorkloadReport,
  type WorkloadResult,
} from "../src/lib/enrichmentReport";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, Object.is(actual, expected), Object.is(actual, expected) ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

/** A run of `rows` results, `misses` of which did not succeed. Mirrors fixture-details' shape. */
function report(rows: number, misses = 0, over: Partial<WorkloadReport> = {}): WorkloadReport {
  const results: WorkloadResult[] = Array.from({ length: rows }, (_, i) => ({
    id: `2026-09-20:fixture-${i}`,
    result: i < rows - misses ? "ok" : "miss",
    detail: i < rows - misses ? undefined : "not in the day's slate",
  }));
  return {
    workload: "fixture-details",
    budgetMs: 20_000,
    elapsedMs: 14_312,
    scoped: 148,
    eligible: 50,
    processed: Math.min(50, rows),
    remaining: 0,
    budgetExhausted: false,
    okCount: rows - misses,
    failedCount: misses,
    results,
    ...over,
  };
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

console.log("one target produces a valid compact result:");
const one = toCompactWorkloadReport(report(1));
eq("the workload is named", one.workload, "fixture-details");
eq("one row is counted", one.resultCount, 1);
eq("the single row is in the sample", one.sample.length, 1);
eq("nothing is truncated", one.sampleTruncated, false);
eq("nothing is omitted", one.omittedResults, 0);
eq("the success count is right", one.okCount, 1);
eq("the failure count is right", one.failedCount, 0);
check("the sample row keeps its identity", one.sample[0].id === "2026-09-20:fixture-0", one.sample[0].id);
check("a single-target response is small", bytes(one) < 1_000, `${bytes(one)} bytes`);

console.log("\nthe aggregates describe the FULL workload, not the sample:");
// The whole contract: the body gets smaller, the reporting does not get less
// true. A reader must be able to size the run from the response alone.
const big = toCompactWorkloadReport(report(2_082, 13));
eq("scoped survives", big.scoped, 148);
eq("eligible survives", big.eligible, 50);
eq("processed survives", big.processed, 50);
eq("remaining survives", big.remaining, 0);
eq("timing survives", big.elapsedMs, 14_312);
eq("the budget survives", big.budgetMs, 20_000);
eq("budgetExhausted survives", big.budgetExhausted, false);
// The exact production figures from the incident.
eq("every successful row is counted", big.okCount, 2_069);
eq("every miss is counted", big.failedCount, 13);
eq("the true row count is reported", big.resultCount, 2_082);
eq("the breakdown counts all successes", big.resultCounts.ok, 2_069);
eq("the breakdown counts all misses", big.resultCounts.miss, 13);
check(
  "the breakdown adds up to the whole run",
  Object.values(big.resultCounts).reduce((a, b) => a + b, 0) === 2_082,
  String(Object.values(big.resultCounts).reduce((a, b) => a + b, 0)),
);

console.log("\nthe diagnostic sample is capped and says so:");
eq("the sample is capped", big.sample.length, WORKLOAD_SAMPLE_LIMIT);
eq("truncation is indicated", big.sampleTruncated, true);
eq("the omitted count is exact", big.omittedResults, 2_082 - WORKLOAD_SAMPLE_LIMIT);
eq("the cap is reported so a reader knows the window", big.sampleLimit, WORKLOAD_SAMPLE_LIMIT);
check("the cap is a small diagnostic window", WORKLOAD_SAMPLE_LIMIT >= 5 && WORKLOAD_SAMPLE_LIMIT <= 10, String(WORKLOAD_SAMPLE_LIMIT));

console.log("\nfailures stay visible even when the sample is all successes:");
// The first ten rows of this run all succeeded, so `sample` alone would show
// no trace of the 13 misses — exactly the rows anyone reading this is after.
check("the sample happens to be all successes", big.sample.every((r) => r.result === "ok"));
eq("the misses are still surfaced", big.failures.length, 10);
check("and they are the failing rows", big.failures.every((r) => r.result !== "ok"), big.failures[0]?.result);
eq("the failure list is capped too", big.failures.length <= WORKLOAD_SAMPLE_LIMIT, true);
eq("failure truncation is indicated", big.failuresTruncated, true);
eq("the omitted failure count is exact", big.omittedFailures, 3);
// A clean run says so rather than inventing failures.
const clean = toCompactWorkloadReport(report(500, 0));
eq("a clean run has no failure rows", clean.failures.length, 0);
eq("a clean run does not claim truncated failures", clean.failuresTruncated, false);
eq("...and still reports every success", clean.okCount, 500);

console.log("\nthe response does not grow with the workload:");
const sizes = [1, 50, 500, 2_082, 10_000].map((n) => ({ n, size: bytes(toCompactWorkloadReport(report(n, Math.floor(n / 100)))) }));
for (const { n, size } of sizes) console.log(`    ${String(n).padStart(6)} rows -> ${size} bytes`);
const largest = Math.max(...sizes.map((s) => s.size));
check("even a 10,000-row run stays small", largest < 4_000, `${largest} bytes`);
// The real assertion: more rows must not mean more bytes. Measured between two
// runs that BOTH saturate every sample, so the only remaining variable is the
// workload size itself. (Comparing against a small run instead would measure
// the samples filling up, which is bounded growth by design, not the unbounded
// growth this is guarding against.)
const saturated = (n: number) => bytes(toCompactWorkloadReport(report(n, 50)));
const ratio = saturated(10_000) / saturated(2_082);
check("size is flat as the run grows 5x", ratio < 1.02, `10,000 rows is ${ratio.toFixed(3)}x the size of 2,082`);
// ...and flat again across another order of magnitude.
const ratioBig = saturated(100_000) / saturated(10_000);
check("still flat at 100,000 rows", ratioBig < 1.02, `${ratioBig.toFixed(3)}x`);
// And the thing that actually broke: the full body IS unbounded, which is why
// the compact one has to exist.
const fullBody = bytes(report(10_000, 100));
check("the uncompacted body really is the problem", fullBody > 400_000, `${fullBody} bytes uncompacted`);
check("compaction is a large reduction", fullBody / largest > 100, `${Math.round(fullBody / largest)}x smaller`);

console.log("\nindividual rows cannot blow the bound on their own:");
// A row count cap does not bound a response by itself. One provider error
// carrying a stack trace, or a detail object serialised whole, would do it.
const fat = toCompactWorkloadReport(
  report(3, 3, {
    results: [
      { id: "x".repeat(5_000), result: "failed", detail: "y".repeat(50_000) },
      { id: 42, result: "failed", detail: { nested: "z".repeat(20_000) } },
      // A detail that cannot be serialised must not throw the whole response away.
      { id: 7, result: "failed", detail: (() => { const c: any = {}; c.self = c; return c; })() },
    ],
    okCount: 0,
    failedCount: 3,
  }),
);
check("a giant detail is clamped", fat.sample.every((r) => (r.detail ?? "").length <= WORKLOAD_DETAIL_MAX), String(fat.sample[0].detail?.length));
check("a giant id is clamped", fat.sample.every((r) => r.id.length <= 120), String(fat.sample[0].id.length));
check("an object detail is stringified, not embedded whole", typeof fat.sample[1].detail === "string");
check("a circular detail does not throw", fat.sample[2].detail === "[unserialisable]", String(fat.sample[2].detail));
check("the pathological run is still small", bytes(fat) < 2_000, `${bytes(fat)} bytes`);

console.log("\nan unbounded set of result kinds cannot become an unbounded object:");
const manyKinds = toCompactWorkloadReport(
  report(0, 0, {
    results: Array.from({ length: 500 }, (_, i) => ({ id: i, result: `kind-${i}` })),
    okCount: 0,
    failedCount: 500,
  }),
);
check("the breakdown key count is capped", Object.keys(manyKinds.resultCounts).length <= 21, String(Object.keys(manyKinds.resultCounts).length));
check(
  "overflow is still counted, so the totals stay honest",
  Object.values(manyKinds.resultCounts).reduce((a, b) => a + b, 0) === 500,
  String(Object.values(manyKinds.resultCounts).reduce((a, b) => a + b, 0)),
);

console.log("\nprocessing itself is untouched — this is serialization only:");
// `processed` counts units of work. For fixture-details a unit is a DAY, which
// is why 50 units produced 2,082 rows and why the fix must not be "lower the
// limit": that would do less work to make the body smaller.
const source = report(2_082, 13);
const compacted = toCompactWorkloadReport(source);
eq("the source report still holds every row", source.results.length, 2_082);
eq("compaction does not mutate the source", source.results[0].id, "2026-09-20:fixture-0");
eq("processed still counts units of work, not rows", compacted.processed, 50);
check("rows far exceed units, which is the whole bug", compacted.resultCount > compacted.processed * 40);
// A budget-exhausted run must still report it, or a backlog looks like a quiet slate.
const exhausted = toCompactWorkloadReport(report(900, 5, { budgetExhausted: true, remaining: 31, processed: 19 }));
eq("budget exhaustion survives compaction", exhausted.budgetExhausted, true);
eq("the remaining backlog survives", exhausted.remaining, 31);

console.log("\nevery workload shape compacts, not just fixture-details:");
for (const workload of ["teams", "leagues", "fixture-details", "h2h", "player-stats", "squads", "odds"]) {
  const r = toCompactWorkloadReport(report(120, 4, { workload }));
  check(`${workload}: bounded and named`, r.workload === workload && r.sample.length === WORKLOAD_SAMPLE_LIMIT && bytes(r) < 4_000);
}
// An empty run is a legitimate outcome — nothing due — and must not look broken.
const empty = toCompactWorkloadReport(report(0));
eq("an empty run reports zero rows", empty.resultCount, 0);
eq("an empty run is not truncated", empty.sampleTruncated, false);
eq("an empty run has an empty sample", empty.sample.length, 0);

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
if (failures) process.exitCode = 1;
