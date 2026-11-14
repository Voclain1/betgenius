import type {
  FixtureState,
  OperationPrediction,
  Finding,
} from "./predictionOperations";
const lagosDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function incidentPeriod(
  kickoff: Date | null,
  now: Date,
): "CURRENT" | "HISTORICAL" {
  return kickoff &&
    Number.isFinite(+kickoff) &&
    lagosDay.format(kickoff) < lagosDay.format(now)
    ? "HISTORICAL"
    : "CURRENT";
}
export function settlementFinding(
  p: OperationPrediction,
  f: FixtureState | undefined,
  now: Date,
  minutes: number,
): Finding | null {
  if (
    p.status !== "PUBLISHED" ||
    p.outcome !== "PENDING" ||
    !p.kickoff ||
    !Number.isFinite(+p.kickoff) ||
    p.kickoff >= now
  )
    return null;
  const aged = +now - +p.kickoff > minutes * 60000,
    final = !!f && ["FT", "AET", "PEN"].includes(f.status);
  if (!aged && !final) return null;
  const period = incidentPeriod(p.kickoff, now),
    base = { predictionId: p.id, period };
  if (p.manualSettlementOnly)
    return {
      ...base,
      code: "MANUAL_SETTLEMENT_QUEUE",
      severity: "INFO",
      detail:
        "Automatic settlement is disabled for this prediction. Review the recorded reason; age alone is not a settlement failure.",
      repair: "MANUAL_REVIEW",
    };
  if (p.marketType === "SAME_GAME_DOUBLE")
    return {
      ...base,
      code: "COMPOUND_SETTLEMENT_QUEUE",
      severity: "INFO",
      detail:
        "This prediction settles from its component outcomes, not directly from a fixture score. Inspect pending/manual legs.",
      repair: "MANUAL_REVIEW",
    };
  if (f && f.kickoff > now)
    return {
      ...base,
      code: "RESCHEDULED_FIXTURE_PENDING",
      severity: "INFO",
      detail:
        "Cached fixture kickoff is in the future; stored prediction kickoff may be outdated. Live status has not been verified.",
      repair: "MANUAL_REVIEW",
    };
  if (f && ["PST", "CANC", "ABD", "SUSP", "INT"].includes(f.status))
    return {
      ...base,
      code: "NONFINAL_FIXTURE_PENDING",
      severity: "INFO",
      detail: `Cached provider status ${f.status}; do not infer a final outcome from elapsed time. Live verification is required.`,
      repair: "MANUAL_REVIEW",
    };
  if (final)
    return {
      ...base,
      code: "FINISHED_UNSETTLED",
      severity: aged ? "WARNING" : "INFO",
      detail:
        "Cached fixture status is final while the published prediction remains pending. This is cached evidence, not live verification; validate score, identity and eligibility before recovery.",
      repair: "MANUAL_REVIEW",
    };
  return {
    ...base,
    code: "SETTLEMENT_STATUS_UNVERIFIED",
    severity: "INFO",
    detail: f
      ? `Stored kickoff is old, but cached status ${f.status} does not confirm a final result.`
      : "Stored kickoff is old and no native fixture status is available. This is not a verified overdue settlement.",
    repair: "MANUAL_REVIEW",
  };
}
export function groupFindings(findings: readonly Finding[]) {
  const groups = new Map<
    string,
    {
      code: string;
      severity: Finding["severity"];
      period: string;
      count: number;
      samples: Finding[];
    }
  >();
  for (const f of findings) {
    const period = f.period ?? "CURRENT",
      key = JSON.stringify([f.code, f.severity, period]);
    const g = groups.get(key) ?? {
      code: f.code,
      severity: f.severity,
      period,
      count: 0,
      samples: [],
    };
    g.count++;
    if (g.samples.length < 10) g.samples.push(f);
    groups.set(key, g);
  }
  const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return [...groups.values()].sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      a.period.localeCompare(b.period) ||
      b.count - a.count ||
      a.code.localeCompare(b.code),
  );
}

/** Nigeria uses UTC+1 year-round. This boundary is independent of the host timezone. */
export function currentLagosDayStart(now: Date): Date {
  const shifted = new Date(+now + 3600000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(+shifted - 3600000);
}
