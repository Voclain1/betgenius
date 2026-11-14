import { meaningfulCompletion, type Completion } from "./predictionOperations";
export type JobCompletion = {
  status: Completion | "MAINTENANCE_COMPLETE" | "DEFERRED";
  outputs: number | null;
  failures: number | null;
  reason: string;
  needsReview?: number;
};
const object = (x: unknown): Record<string, any> =>
  x && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, any>)
    : {};
const count = (p: Record<string, any>, key: string): number | null =>
  typeof p[key] === "number" && Number.isFinite(p[key]) && p[key] >= 0
    ? p[key]
    : null;
export function assessJobCompletion(
  job: string,
  payload: unknown,
  httpStatus = 200,
): JobCompletion {
  const p = object(payload),
    result = (
      status: JobCompletion["status"],
      outputs: number | null,
      failures: number | null,
      reason: string,
      needsReview = 0,
    ): JobCompletion => ({
      status,
      outputs,
      failures,
      reason,
      ...(needsReview ? { needsReview } : {}),
    });
  if (httpStatus >= 400)
    return result("FAILED", null, null, "TRANSPORT_FAILURE");
  const hardError = !!p.error,
    failed = count(p, "failed") ?? 0;
  if (!hardError && !failed && p.ok === false && typeof p.reason === "string") {
    if (/another generation run is already in progress/i.test(p.reason))
      return result("DEFERRED", 0, 0, "WORKER_LEASE_HELD");
    if (/daily budget nearly exhausted|quota.*exhausted/i.test(p.reason))
      return result("DEFERRED", 0, 0, "QUOTA_GUARD");
  }
  if (hardError || p.ok === false)
    return result("FAILED", null, Math.max(1, failed), "EXPLICIT_FAILURE");
  if (
    job === "generation-discovery" &&
    count(p, "candidatesQueued") != null &&
    count(p, "leaguesScanned") != null
  ) {
    if (p.candidatesQueued > 0)
      return result(
        "USEFUL_OUTPUT",
        p.candidatesQueued,
        0,
        "CANDIDATES_QUEUED",
      );
    if (p.leaguesScanned > 0)
      return result(
        "MAINTENANCE_COMPLETE",
        0,
        0,
        "DISCOVERY_SCAN_NO_NEW_CANDIDATES",
      );
    if (p.leaguesPlanned === 0)
      return result("NO_WORK", 0, 0, "NO_LEAGUES_PLANNED");
    return result(
      "UNKNOWN",
      null,
      null,
      "PLANNED_SCAN_WITHOUT_PROGRESS_EVIDENCE",
    );
  }
  if (
    job === "refresh-odds" &&
    count(p, "okCount") != null &&
    count(p, "failedCount") != null &&
    count(p, "processed") != null
  ) {
    const unavailable = Array.isArray(p.results)
      ? p.results.filter(
          (r) =>
            r?.result === "failed" &&
            typeof r.detail === "string" &&
            /No bookmaker prices quoted for this fixture yet/i.test(r.detail),
        ).length
      : 0;
    const failures = Math.max(
      0,
      p.failedCount - Math.min(p.failedCount, unavailable),
    );
    if (failures > 0)
      return result(
        p.okCount > 0 ? "PARTIAL_FAILURE" : "FAILED",
        p.okCount,
        failures,
        "QUOTE_REFRESH_FAILURES",
      );
    if (p.okCount > 0)
      return result("MAINTENANCE_COMPLETE", p.okCount, 0, "QUOTES_REFRESHED");
    if (p.processed > 0 && unavailable === p.processed)
      return result("NO_WORK", 0, 0, "PROVIDER_RETURNED_NO_QUOTES");
    if (p.processed === 0 && p.eligible === 0)
      return result("NO_WORK", 0, 0, "NO_QUOTES_DUE");
    if (p.processed === 0 && p.budgetExhausted === true)
      return result("DEFERRED", 0, 0, "REFRESH_BUDGET_GUARD");
    return result("UNKNOWN", null, null, "REFRESH_WITHOUT_OUTCOME_EVIDENCE");
  }
  if (job === "select-bet-of-the-day") {
    if (p.action === "pinned" && typeof p.selectedId === "string")
      return result("USEFUL_OUTPUT", 1, 0, "SELECTION_PINNED");
    if (p.action === "kept")
      return result("MAINTENANCE_COMPLETE", 0, 0, "EXISTING_SELECTION_KEPT");
    if (p.action === "skipped-manual-pin")
      return result("MAINTENANCE_COMPLETE", 0, 0, "MANUAL_PIN_PRESERVED");
    if (p.action === "no-eligible-candidate")
      return result("NO_WORK", 0, 0, "NO_ELIGIBLE_SELECTION");
  }
  if (
    job === "generate-ordinary" &&
    p.banker &&
    count(object(p.banker), "considered") != null
  )
    return result("MAINTENANCE_COMPLETE", 0, 0, "BANKER_CURATION_ALIAS");
  if (
    job.startsWith("generate-") &&
    count(p, "predictionsCreated") != null &&
    count(p, "claimed") != null &&
    count(p, "failed") != null
  ) {
    const published =
      count(object(p.goals), "published") ??
      count(object(p.vipPremium), "published") ??
      0;
    const outputs = p.predictionsCreated || published;
    if (failed)
      return result(
        outputs > 0 ? "PARTIAL_FAILURE" : "FAILED",
        outputs,
        failed,
        "GENERATION_FAILURES",
      );
    if (outputs > 0)
      return result(
        "USEFUL_OUTPUT",
        outputs,
        0,
        "PREDICTION_OR_PUBLICATION_OUTPUT",
      );
    if (p.claimed === 0)
      return result("NO_WORK", 0, 0, "NO_ELIGIBLE_GENERATION_TARGET");
    if ((count(p, "succeeded") ?? 0) > 0)
      return result(
        "MAINTENANCE_COMPLETE",
        0,
        0,
        "COMPLETED_WITHOUT_NEW_PREDICTIONS",
      );
    return result("UNKNOWN", null, null, "CLAIMED_WORK_WITHOUT_COMPLETION");
  }
  if (job === "settle" || job === "results-pass") {
    if (job === "results-pass" && p.ran === false)
      return result("DEFERRED", 0, 0, "RESULTS_PASS_LEASE_INTERVAL");
    if (count(p, "settled") != null && count(p, "checked") != null) {
      const outputs = p.settled + (count(p, "doublesSettled") ?? 0),
        rows = [
          ...(Array.isArray(p.results) ? p.results : []),
          ...(Array.isArray(p.doubleResults) ? p.doubleResults : []),
        ];
      const errors = rows.filter((r) =>
        ["error", "provider_unavailable"].includes(r?.result),
      ).length;
      const review = rows.filter((r) =>
        ["manual_required", "unresolvable", "abandoned"].includes(r?.result),
      ).length;
      if (errors)
        return result(
          outputs ? "PARTIAL_FAILURE" : "FAILED",
          outputs,
          errors,
          "SETTLEMENT_LOOKUP_FAILURE",
          review,
        );
      if (outputs)
        return result("USEFUL_OUTPUT", outputs, 0, "OUTCOMES_SETTLED", review);
      if (review)
        return result(
          "MAINTENANCE_COMPLETE",
          0,
          0,
          "SETTLEMENT_REQUIRES_REVIEW",
          review,
        );
      if (
        job === "settle" &&
        (p.curation || count(object(p.upcomingKickoffs), "checked") != null)
      )
        return result(
          "MAINTENANCE_COMPLETE",
          0,
          0,
          "CURATION_OR_KICKOFF_MAINTENANCE",
        );
      return result(
        "NO_WORK",
        0,
        0,
        p.checked === 0
          ? "NO_ELIGIBLE_PENDING_SINGLES"
          : "AWAITING_CONFIRMED_FINAL_EVIDENCE",
      );
    }
  }
  const fallback = meaningfulCompletion(payload, httpStatus);
  return {
    ...fallback,
    reason:
      fallback.status === "UNKNOWN"
        ? "UNRECOGNIZED_RESULT_SHAPE"
        : "GENERIC_RECORDED_COUNTERS",
  };
}
