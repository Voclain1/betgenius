import { incidentPeriod, settlementFinding } from "./settlementDiagnostics";
/** Sprint 07 read-only operational assessments. No provider requests or repairs. */
export const OPERATIONS_VERSION = "operations-s07-v1";
export type FreshnessStatus =
  | "FRESH"
  | "AGING"
  | "STALE"
  | "MISSING"
  | "PROVIDER_UNAVAILABLE"
  | "UNKNOWN";
export const FRESHNESS_MINUTES = {
  fixture: 180,
  odds: 120,
  enrichment: 1440,
  generation: 2880,
  publication: 120,
  settlement: 360,
} as const;
export function freshness(input: {
  fetchedAt: Date | null;
  now: Date;
  maxMinutes: number;
  lastError?: string | null;
  supported?: boolean;
}) {
  if (input.supported === false)
    return { status: "UNKNOWN" as FreshnessStatus, ageMinutes: null };
  if (
    !Number.isFinite(+input.now) ||
    !Number.isFinite(input.maxMinutes) ||
    input.maxMinutes <= 0
  )
    throw new Error("Invalid freshness policy");
  const ageMinutes = input.fetchedAt
    ? (+input.now - +input.fetchedAt) / 60000
    : null;
  const noQuotes =
    !!input.lastError &&
    /No bookmaker prices quoted|no fixture.*match|not found|no data returned/i.test(
      input.lastError,
    );
  const fetchFailure =
    !!input.lastError &&
    /timeout|timed out|network|no response|ECONN|HTTP [45]\d\d|rate limit|quota|subscription|plan restriction/i.test(
      input.lastError,
    );
  const status: FreshnessStatus = noQuotes
    ? "MISSING"
    : input.lastError
      ? fetchFailure
        ? "PROVIDER_UNAVAILABLE"
        : "UNKNOWN"
      : ageMinutes == null
        ? "MISSING"
        : !Number.isFinite(ageMinutes) || ageMinutes < 0
          ? "UNKNOWN"
          : ageMinutes > input.maxMinutes
            ? "STALE"
            : ageMinutes > input.maxMinutes * 0.75
              ? "AGING"
              : "FRESH";
  return {
    status,
    ageMinutes:
      ageMinutes != null && Number.isFinite(ageMinutes) ? ageMinutes : null,
  };
}
export function freshnessThresholds(
  env: Record<string, string | undefined> = process.env,
) {
  return Object.fromEntries(
    Object.entries(FRESHNESS_MINUTES).map(([key, value]) => {
      const n = Number(env[`OPS_FRESHNESS_${key.toUpperCase()}_MINUTES`]);
      return [key, Number.isFinite(n) && n >= 1 && n <= 10080 ? n : value];
    }),
  ) as Record<keyof typeof FRESHNESS_MINUTES, number>;
}
export type Completion =
  | "USEFUL_OUTPUT"
  | "NO_WORK"
  | "PARTIAL_FAILURE"
  | "FAILED"
  | "UNKNOWN";
/** Preserve transport status separately; 200 is not proof of useful work. */
export function meaningfulCompletion(
  payload: unknown,
  httpStatus = 200,
): { status: Completion; outputs: number | null; failures: number | null } {
  if (httpStatus >= 400)
    return { status: "FAILED", outputs: null, failures: null };
  if (!payload || typeof payload !== "object")
    return { status: "UNKNOWN", outputs: null, failures: null };
  const p = payload as Record<string, unknown>;
  const counts = (names: string[]) =>
    names.flatMap((k) =>
      typeof p[k] === "number" && Number.isFinite(p[k]) && Number(p[k]) >= 0
        ? [Number(p[k])]
        : [],
    );
  const out = counts([
    "generated",
    "published",
    "settled",
    "doublesSettled",
    "updated",
    "succeeded",
  ]);
  const failures = counts(["failed", "errors", "abandoned"]);
  if (Array.isArray(p.results) && !failures.some((n) => n > 0)) {
    const failedRows = p.results.filter(
      (r) =>
        r &&
        typeof r === "object" &&
        [
          "error",
          "provider_unavailable",
          "manual_required",
          "unresolvable",
          "abandoned",
        ].includes((r as { result: string }).result),
    ).length;
    if (failedRows) failures.push(failedRows);
  }
  if (p.ok === false || p.error)
    return {
      status: "FAILED",
      outputs: out.length ? out.reduce((a, b) => a + b, 0) : null,
      failures: Math.max(
        1,
        failures.reduce((a, b) => a + b, 0),
      ),
    };
  const outputs = out.length ? out.reduce((a, b) => a + b, 0) : null;
  const failed = failures.length ? failures.reduce((a, b) => a + b, 0) : null;
  return {
    status: failed
      ? outputs
        ? "PARTIAL_FAILURE"
        : "FAILED"
      : outputs != null
        ? outputs > 0
          ? "USEFUL_OUTPUT"
          : "NO_WORK"
        : "UNKNOWN",
    outputs,
    failures: failed,
  };
}
export type Finding = {
  period?: "CURRENT" | "HISTORICAL";
  code: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  predictionId?: string;
  detail: string;
  repair: "MANUAL_REVIEW" | "REFRESH_ODDS" | "RETRY_SETTLEMENT" | null;
};
export type OperationPrediction = {
  id: string;
  observationExpected?: boolean;
  paidPublicationEvidenceRequired?: boolean;
  status: string;
  outcome: string;
  kickoff: Date | null;
  createdAt: Date;
  publishedAt: Date | null;
  settledAt: Date | null;
  marketType: string;
  selection: unknown;
  category: string;
  categories: string[];
  fixtureApiId: number | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  manualSettlementOnly: boolean;
};
export type FixtureState = {
  status: string;
  kickoff: Date;
  homeScore: number | null;
  awayScore: number | null;
  updatedAt: Date;
};
export const FINAL_FIXTURE_STATUSES = new Set(["FT", "AET", "PEN"]);
export const NON_PUBLISHABLE_STATUSES = new Set([
  "1H",
  "HT",
  "2H",
  "ET",
  "BT",
  "P",
  "SUSP",
  "INT",
  "LIVE",
  "FT",
  "AET",
  "PEN",
  "PST",
  "CANC",
  "ABD",
  "AWD",
  "WO",
]);
export function publicationStatusProblem(
  fixture: FixtureState | null,
  kickoff: Date | null,
  now: Date,
): string | null {
  if (kickoff && (!Number.isFinite(+kickoff) || kickoff <= now))
    return "KICKOFF_PASSED_OR_INVALID";
  if (
    fixture &&
    (NON_PUBLISHABLE_STATUSES.has(fixture.status) || fixture.kickoff <= now)
  )
    return "FIXTURE_NOT_PREMATCH";
  if (fixture && kickoff && Math.abs(+fixture.kickoff - +kickoff) > 60000)
    return "FIXTURE_SCHEDULE_DISAGREEMENT";
  return null;
}
export function reconcilePredictions(
  rows: readonly OperationPrediction[],
  fixtures: ReadonlyMap<number, FixtureState>,
  evidence: ReadonlySet<string>,
  observed: ReadonlySet<string>,
  now: Date,
  settlementMinutes: number = FRESHNESS_MINUTES.settlement,
): Finding[] {
  const out: Finding[] = [];
  const seen = new Map<string, string>();
  const add = (
    p: OperationPrediction,
    code: string,
    severity: Finding["severity"],
    detail: string,
    repair: Finding["repair"] = "MANUAL_REVIEW",
  ) =>
    out.push({
      predictionId: p.id,
      period: incidentPeriod(p.kickoff, now),
      code,
      severity,
      detail,
      repair,
    });
  for (const p of rows) {
    const f = p.fixtureApiId != null ? fixtures.get(p.fixtureApiId) : undefined;
    if (p.status === "PUBLISHED") {
      if (!p.publishedAt)
        add(
          p,
          "MISSING_PUBLICATION_TIME",
          "WARNING",
          "Published state lacks publication time",
        );
      if (p.publishedAt && p.kickoff && p.publishedAt >= p.kickoff)
        add(
          p,
          "LATE_PUBLICATION",
          "CRITICAL",
          "Publication time is at or after kickoff",
        );
      const paid =
        p.categories.some((c) => c === "VIP" || c === "PREMIUM") ||
        p.category === "VIP" ||
        p.category === "PREMIUM";
      if (paid && !evidence.has(p.id))
        add(
          p,
          p.paidPublicationEvidenceRequired
            ? "MISSING_PAID_EVIDENCE"
            : "PAID_PRICE_EVIDENCE_UNAVAILABLE",
          p.paidPublicationEvidenceRequired ? "CRITICAL" : "INFO",
          p.paidPublicationEvidenceRequired
            ? "Required atomic paid publication evidence is unavailable; manual verification is needed."
            : "No usable publication price evidence. Ordinary/manual/legacy curation may not have required it; this alone is not a publishing defect.",
        );
      if (
        (p.category === "VIP" || p.category === "PREMIUM") &&
        !p.categories.includes(p.category)
      )
        add(
          p,
          "MISSING_PAID_LINK",
          "CRITICAL",
          "Primary paid category absent from category links",
        );
      if (!p.categories.length)
        add(
          p,
          "MISSING_CATEGORY_LINKS",
          "WARNING",
          "Published prediction has no category relationships",
        );
      if (paid && p.observationExpected === true && !observed.has(p.id))
        add(
          p,
          "MISSING_RELIABILITY_OBSERVATION",
          "INFO",
          "No retained observation for an eligible post-collection candidate. Verify diagnostic settings and curation history before diagnosing collection failure.",
          null,
        );
      const key = JSON.stringify([
        p.fixtureApiId ?? p.kickoff?.toISOString(),
        p.marketType,
        p.selection,
      ]);
      if (p.fixtureApiId != null) {
        const prior = seen.get(key);
        if (prior)
          add(
            p,
            "DUPLICATE_SELECTION",
            "WARNING",
            `Same fixture/selection as ${prior}`,
          );
        else seen.set(key, p.id);
      }
    }
    if (f && p.kickoff && Math.abs(+f.kickoff - +p.kickoff) > 60000)
      add(
        p,
        "KICKOFF_DISAGREEMENT",
        "WARNING",
        "Stored fixture schedule differs; preserve historical decision evidence",
      );
    const settlement = settlementFinding(p, f, now, settlementMinutes);
    if (settlement) out.push(settlement);
    if (
      p.outcome !== "PENDING" &&
      p.settledAt &&
      p.kickoff &&
      p.settledAt < p.kickoff
    )
      add(
        p,
        p.outcome === "VOID" ? "EARLY_VOID_REVIEW" : "SETTLED_BEFORE_KICKOFF",
        p.outcome === "VOID" ? "INFO" : "CRITICAL",
        p.outcome === "VOID"
          ? "Void predates stored kickoff; cancellation/refund or reschedule evidence needs review, not an inferred win/loss."
          : "Settlement timestamp predates stored kickoff; verify schedule history before correcting outcomes.",
      );
    // Native Fixture totals on AET/PEN need regulation evidence; never compare them as FT scores.
    if (
      f?.status === "FT" &&
      p.outcome !== "PENDING" &&
      f.homeScore != null &&
      f.awayScore != null &&
      p.finalHomeScore != null &&
      p.finalAwayScore != null &&
      (f.homeScore !== p.finalHomeScore || f.awayScore !== p.finalAwayScore)
    )
      add(
        p,
        "RESULT_DISCREPANCY",
        "CRITICAL",
        "Provider cache differs from frozen settled score; explicit correction review required",
      );
    if (p.status === "APPROVED" && p.kickoff && p.kickoff <= now)
      add(
        p,
        "EXPIRED_APPROVAL_WINDOW",
        incidentPeriod(p.kickoff, now) === "HISTORICAL" ? "INFO" : "WARNING",
        "Approved prediction was not published before kickoff; never auto-publish it retrospectively.",
      );
    if (p.status === "PENDING_REVIEW" && p.kickoff && p.kickoff <= now)
      add(
        p,
        incidentPeriod(p.kickoff, now) === "HISTORICAL"
          ? "EXPIRED_REVIEW_HISTORY"
          : "MISSED_REVIEW_WINDOW",
        incidentPeriod(p.kickoff, now) === "HISTORICAL" ? "INFO" : "WARNING",
        "Review window passed; do not auto-publish",
      );
  }
  return out;
}
