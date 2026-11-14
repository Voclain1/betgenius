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
  const status: FreshnessStatus = input.lastError
    ? "PROVIDER_UNAVAILABLE"
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
  code: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  predictionId?: string;
  detail: string;
  repair: "MANUAL_REVIEW" | "REFRESH_ODDS" | "RETRY_SETTLEMENT" | null;
};
export type OperationPrediction = {
  id: string;
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
  ) => out.push({ predictionId: p.id, code, severity, detail, repair });
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
          "MISSING_PAID_EVIDENCE",
          "CRITICAL",
          "No independently usable publication evidence",
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
      if (paid && !observed.has(p.id))
        add(
          p,
          "MISSING_RELIABILITY_OBSERVATION",
          "INFO",
          "No retained Sprint 06 first-decision record; dedicated or out-of-universe rows may legitimately lack one",
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
    if (f && FINAL_FIXTURE_STATUSES.has(f.status) && p.outcome === "PENDING")
      add(
        p,
        "FINISHED_UNSETTLED",
        "WARNING",
        "Cached fixture is final but prediction is pending",
        p.manualSettlementOnly ? "MANUAL_REVIEW" : "RETRY_SETTLEMENT",
      );
    if (p.outcome === "PENDING" && p.kickoff && +now - +p.kickoff > settlementMinutes * 60000)
      add(
        p,
        "SETTLEMENT_DELAY",
        "WARNING",
        `Pending more than ${settlementMinutes} minutes after stored kickoff`,
        p.manualSettlementOnly ? "MANUAL_REVIEW" : "RETRY_SETTLEMENT",
      );
    if (
      p.outcome !== "PENDING" &&
      p.settledAt &&
      p.kickoff &&
      p.settledAt < p.kickoff
    )
      add(
        p,
        "SETTLED_BEFORE_KICKOFF",
        "CRITICAL",
        "Settlement timestamp predates kickoff",
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
    if (p.status === "PENDING_REVIEW" && p.kickoff && p.kickoff <= now)
      add(
        p,
        "MISSED_REVIEW_WINDOW",
        "WARNING",
        "Review window passed; do not auto-publish",
      );
  }
  return out;
}
