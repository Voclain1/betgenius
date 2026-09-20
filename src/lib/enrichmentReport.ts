/**
 * Bounding the enrichment workload response.
 *
 * THE INCIDENT THIS EXISTS FOR. cron-job.org disabled
 * /api/admin/refresh-enrichment/fixture-details?limit=50 after 27 consecutive
 * scheduler failures recorded as "Failed (output too large)". The job was
 * healthy throughout: HTTP 200, 2,082 successful cache attempts in 24h, 13
 * legitimate slate misses, zero provider errors. Nothing crashed, nothing timed
 * out, nothing hit a 429. The scheduler simply gave up reading a response body
 * that had grown past what it will accept.
 *
 * WHY THAT WORKLOAD AND NOT THE OTHERS. `limit` counts UNITS OF WORK, and for
 * fixture-details a unit is a kickoff DAY, not a fixture — refreshFixtureDetailsForDay
 * returns one row per fixture in that day's slate. So limit=50 means up to 50
 * days, and 50 days of European football is thousands of result rows. Every
 * other workload is one result per unit, which is why `processed` stays small
 * and reads as safe while `results` quietly grows by two orders of magnitude.
 * The same limit that costs 50 upstream calls can produce a multi-megabyte body.
 *
 * WHAT THIS DOES AND DOES NOT CHANGE. Serialization only. runEnrichmentWorkload
 * still processes exactly the same targets, makes exactly the same upstream
 * calls, and still returns its full results array to in-process callers such as
 * scripts/run-odds-refresh.ts. Nothing here touches the limit, the budget, the
 * ordering or which fixtures are selected — lowering the limit to shrink the
 * body would have "fixed" the symptom by doing less work, which is the opposite
 * of what the job is for.
 *
 * The aggregates describe the WHOLE run. The sample is a fixed-size diagnostic
 * window onto it, and says so when it is not the whole story.
 */

/** One row as the workloads produce it. `detail` is free-form, so it is treated as untrusted width. */
export type WorkloadResult = { id: number | string; result: string; detail?: unknown };

/** The full in-process report. Structurally what runEnrichmentWorkload returns. */
export type WorkloadReport = {
  workload: string;
  budgetMs: number;
  elapsedMs: number;
  scoped: number;
  eligible: number;
  processed: number;
  remaining: number;
  budgetExhausted: boolean;
  okCount: number;
  failedCount: number;
  results: WorkloadResult[];
};

/**
 * How many result rows the response may carry, per sample.
 *
 * Ten is a diagnostic window, not a data feed: enough to see what the rows look
 * like and to recognise a systematic failure, small enough that the response
 * size stops depending on the size of the run. Anything genuinely quantitative
 * belongs in the aggregates, which describe every row.
 */
export const WORKLOAD_SAMPLE_LIMIT = 10;

/**
 * Per-field width caps.
 *
 * A capped ROW COUNT alone does not bound a response: one row carrying a
 * provider error with a stack trace, or a detail object serialised whole, is
 * unbounded on its own. Both axes have to be closed for the guarantee to hold.
 */
export const WORKLOAD_DETAIL_MAX = 200;
export const WORKLOAD_ID_MAX = 120;

/**
 * Distinct `result` kinds reported in the breakdown.
 *
 * The kinds are a small closed vocabulary today ("ok", "miss", "failed"), so
 * this cap never binds in practice. It exists because the breakdown is keyed by
 * a value the workloads produce, and an unbounded key space is an unbounded
 * object — the same mistake as the results array, one level down. Overflow is
 * summed into `other` so the counts still add up to the full workload.
 */
export const WORKLOAD_RESULT_KIND_MAX = 20;

const clamp = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

function compactRow(row: WorkloadResult) {
  const detail =
    row.detail == null
      ? undefined
      : clamp(typeof row.detail === "string" ? row.detail : safeStringify(row.detail), WORKLOAD_DETAIL_MAX);
  return { id: clamp(String(row.id), WORKLOAD_ID_MAX), result: clamp(String(row.result), WORKLOAD_ID_MAX), ...(detail ? { detail } : {}) };
}

/** A detail that is an object (player-stats passes `counts`) must not be able to throw or to sprawl. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserialisable]";
  }
}

export type CompactWorkloadReport = ReturnType<typeof toCompactWorkloadReport>;

/**
 * The bounded, cron-safe view of a run.
 *
 * Pure, and takes the full report rather than reaching for it, so the bound can
 * be asserted against a synthetic ten-thousand-row run without touching a
 * database or the football API (scripts/check-enrichment-report.ts).
 *
 * Every aggregate counts the FULL workload — `resultCount` is the true number
 * of rows the run produced, not the number shown. That distinction is the whole
 * contract: the response gets smaller, the reporting does not get less true.
 */
export function toCompactWorkloadReport(report: WorkloadReport, sampleLimit = WORKLOAD_SAMPLE_LIMIT) {
  const results = report.results ?? [];

  // Breakdown over EVERY row, not just the sampled ones.
  const counts = new Map<string, number>();
  for (const row of results) {
    const kind = String(row?.result ?? "unknown");
    if (counts.has(kind) || counts.size < WORKLOAD_RESULT_KIND_MAX) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    else counts.set("other", (counts.get("other") ?? 0) + 1);
  }

  // Two windows. `sample` is the first N rows — what the run looked like.
  // `failures` is the first N non-ok rows, which `sample` can easily miss
  // entirely: a run whose first ten rows all succeeded would otherwise show no
  // trace of the eleventh that did not, and those are the rows anyone reading
  // this response is actually looking for.
  const sample = results.slice(0, sampleLimit).map(compactRow);
  const failureRows = results.filter((r) => r?.result !== "ok");
  const failures = failureRows.slice(0, sampleLimit).map(compactRow);

  return {
    workload: report.workload,
    budgetMs: report.budgetMs,
    elapsedMs: report.elapsedMs,
    scoped: report.scoped,
    eligible: report.eligible,
    processed: report.processed,
    remaining: report.remaining,
    budgetExhausted: report.budgetExhausted,
    okCount: report.okCount,
    failedCount: report.failedCount,
    /** Rows the run actually produced. For fixture-details this is fixtures, while `processed` is days. */
    resultCount: results.length,
    resultCounts: Object.fromEntries(counts),
    sample,
    /** True when `sample` is not the whole run — the reader is looking at a window. */
    sampleTruncated: results.length > sample.length,
    omittedResults: Math.max(0, results.length - sample.length),
    sampleLimit,
    failures,
    failuresTruncated: failureRows.length > failures.length,
    omittedFailures: Math.max(0, failureRows.length - failures.length),
  };
}
