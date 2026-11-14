import {
  reliabilityMetrics,
  RELIABILITY_VERSION,
} from "./predictionReliability";

/** Fixed before any Sprint 06 data is evaluated. These dates must not be moved after seeing outcomes. */
export const RELIABILITY_PROTOCOL = {
  version: "s06-prospective-202612-v1",
  snapshotVersion: RELIABILITY_VERSION,
  developmentStart: "2026-12-01T00:00:00.000Z",
  validationStart: "2027-01-01T00:00:00.000Z",
  holdoutStart: "2027-02-01T00:00:00.000Z",
  holdoutEnd: "2027-03-01T00:00:00.000Z",
  matureAt: "2027-03-08T00:00:00.000Z",
  candidates: ["calibrated", "lowerBoundValue", "diversified"] as const,
  minDecided: 100,
  minFixtureDays: 20,
  minCoverage: 0.8,
  minRetention: 0.5,
  // Three hypotheses, separately VIP and PREMIUM: 6 simultaneous comparisons.
  familySize: 6,
  bootstrapReplicates: 2000,
  alpha: 0.05,
  promotion:
    "Development and validation improvement, then one final holdout; reviewed approval always required",
};
export type ProspectiveObservation = {
  version: string;
  id: string;
  tier: "VIP" | "PREMIUM";
  fixture: string;
  decisionAt: string;
  kickoff: string;
  market: string;
  competition: number | null;
  settledAt: string | null;
  outcome: "WON" | "LOST" | "VOID" | null;
  rawConfidence: number;
  baselineSelected: boolean;
  policies: Record<string, boolean> | null;
  price: { status: string; median: number | null };
  estimate: { p: number | null };
};

/** First decision per prediction/tier. Invalid, post-kickoff and pre-protocol snapshots are not eligible. */
export function protocolCohort(rows: readonly ProspectiveObservation[]) {
  const unique = new Map<string, ProspectiveObservation>();
  for (const r of [...rows].sort(
    (a, b) =>
      Date.parse(a.decisionAt) - Date.parse(b.decisionAt) ||
      a.id.localeCompare(b.id),
  )) {
    const at = Date.parse(r.decisionAt),
      ko = Date.parse(r.kickoff);
    if (
      r.version !== RELIABILITY_VERSION ||
      !Number.isFinite(at) ||
      !Number.isFinite(ko) ||
      at >= ko ||
      at < Date.parse(RELIABILITY_PROTOCOL.developmentStart) ||
      ko >= Date.parse(RELIABILITY_PROTOCOL.holdoutEnd) ||
      !["MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS"].includes(
        r.market,
      ) ||
      (r.tier !== "VIP" && r.tier !== "PREMIUM")
    )
      continue;
    const key = JSON.stringify([r.tier, r.id]);
    if (!unique.has(key)) unique.set(key, r);
  }
  return [...unique.values()];
}

function performance(rows: readonly ProspectiveObservation[], asOf: Date) {
  const decided = rows.filter(
    (r) =>
      (r.outcome === "WON" || r.outcome === "LOST") &&
      r.settledAt &&
      Date.parse(r.settledAt) >= Date.parse(r.kickoff) &&
      Date.parse(r.settledAt) <= +asOf,
  );
  const priced = decided.filter(
    (r) =>
      r.price.status === "VALID" &&
      r.price.median != null &&
      Number.isFinite(r.price.median) &&
      r.price.median > 1,
  );
  const returns = priced.map((r) => ({
    day: r.kickoff.slice(0, 10),
    value: r.outcome === "WON" ? r.price.median! - 1 : -1,
  }));
  const score = reliabilityMetrics(
    decided.map((r) => ({
      raw: r.rawConfidence / 100,
      outcome: r.outcome === "WON" ? 1 : 0,
    })),
  );
  const calibrated = decided.filter(
    (r) =>
      r.estimate.p != null &&
      Number.isFinite(r.estimate.p) &&
      r.estimate.p >= 0 &&
      r.estimate.p <= 1,
  );
  const calibratedScore = reliabilityMetrics(
    calibrated.map((r) => ({
      raw: r.estimate.p!,
      outcome: r.outcome === "WON" ? 1 : 0,
    })),
  );
  return {
    ...score,
    calibrated: calibratedScore,
    selected: rows.length,
    pendingOrVoid: rows.length - decided.length,
    priced: priced.length,
    coverage: decided.length ? priced.length / decided.length : 0,
    fixtureDays: new Set(returns.map((r) => r.day)).size,
    decisionReferenceReturn: priced.length
      ? returns.reduce((s, r) => s + r.value, 0) / priced.length
      : null,
    realizedReturn: null,
    returns,
  };
}
/** Paired day-cluster bootstrap, deterministic seed; overlapping baseline/candidate picks stay paired. */
function differenceInterval(
  a: ReturnType<typeof performance>,
  b: ReturnType<typeof performance>,
) {
  const days = [
    ...new Set([...a.returns, ...b.returns].map((r) => r.day)),
  ].sort();
  if (
    days.length < RELIABILITY_PROTOCOL.minFixtureDays ||
    a.priced < 100 ||
    b.priced < 100
  )
    return null;
  const aggregate = (rs: typeof a.returns) =>
    new Map(
      days.map((d) => {
        const g = rs.filter((r) => r.day === d);
        return [d, { n: g.length, sum: g.reduce((s, r) => s + r.value, 0) }];
      }),
    );
  const aa = aggregate(a.returns),
    bb = aggregate(b.returns);
  let seed = 6027;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const diffs: number[] = [];
  for (let i = 0; i < RELIABILITY_PROTOCOL.bootstrapReplicates; i++) {
    let an = 0,
      bn = 0,
      ap = 0,
      bp = 0;
    for (let j = 0; j < days.length; j++) {
      const d = days[Math.floor(random() * days.length)],
        x = aa.get(d)!,
        y = bb.get(d)!;
      an += x.n;
      ap += x.sum;
      bn += y.n;
      bp += y.sum;
    }
    if (an && bn) diffs.push(bp / bn - ap / an);
  }
  diffs.sort((x, y) => x - y);
  const tail =
    RELIABILITY_PROTOCOL.alpha / (2 * RELIABILITY_PROTOCOL.familySize);
  return [
    diffs[Math.floor(diffs.length * tail)],
    diffs[Math.min(diffs.length - 1, Math.ceil(diffs.length * (1 - tail)))],
  ];
}

export function evaluateProspective(
  rows: readonly ProspectiveObservation[],
  asOf: Date,
  phase: "validation" | "holdout" = "validation",
) {
  const p = RELIABILITY_PROTOCOL;
  if (!Number.isFinite(+asOf)) throw new Error("Invalid evaluation time");
  if (phase === "holdout" && +asOf < Date.parse(p.matureAt))
    throw new Error("Final holdout has not matured");
  const cohort = protocolCohort(rows).filter(
    (r) => Date.parse(r.decisionAt) <= +asOf,
  );
  const sections = (["VIP", "PREMIUM"] as const).map((tier) => {
    const report = (start: string, end: string) => {
      // Split by kickoff, and reject snapshots that had not been recorded before that phase ended.
      const universe = cohort.filter(
        (r) =>
          r.tier === tier &&
          r.kickoff >= start &&
          r.kickoff < end &&
          r.decisionAt < end,
      );
      const baseline = performance(
        universe.filter((r) => r.baselineSelected),
        asOf,
      );
      const candidates = p.candidates.map((name) => {
        // Subset-only tests; candidate flags were recorded at decision time, never reconstructed from settlement.
        const candidate = performance(
          universe.filter(
            (r) => r.baselineSelected && r.policies?.[name] === true,
          ),
          asOf,
        );
        const interval = differenceInterval(baseline, candidate);
        const warnings: string[] = [];
        if (candidate.n < p.minDecided)
          warnings.push("INSUFFICIENT_DECIDED_SAMPLE");
        if (
          candidate.coverage < p.minCoverage ||
          baseline.coverage < p.minCoverage
        )
          warnings.push("INSUFFICIENT_PRICE_COVERAGE");
        if (candidate.n < baseline.n * p.minRetention)
          warnings.push("INSUFFICIENT_RETENTION");
        if (candidate.fixtureDays < p.minFixtureDays)
          warnings.push("INSUFFICIENT_FIXTURE_DAYS");
        if (candidate.pendingOrVoid || baseline.pendingOrVoid)
          warnings.push("UNRESOLVED_OR_VOID_OUTCOMES");
        if (!interval || interval[0] <= 0)
          warnings.push("NO_MULTIPLICITY_ADJUSTED_IMPROVEMENT");
        if (
          candidate.winRate == null ||
          baseline.winRate == null ||
          candidate.winRate < baseline.winRate
        )
          warnings.push("NO_WIN_RATE_NONINFERIORITY");
        const { returns: _, ...metrics } = candidate;
        return {
          name,
          ...metrics,
          referenceDifferenceInterval: interval,
          warnings,
          passed: !warnings.length,
        };
      });
      const { returns: _, ...metrics } = baseline;
      return { universe: universe.length, baseline: metrics, candidates };
    };
    const development = report(p.developmentStart, p.validationStart);
    const validation = report(p.validationStart, p.holdoutStart);
    const promoted = p.candidates.filter(
      (name) =>
        development.candidates.find((c) => c.name === name)?.passed &&
        validation.candidates.find((c) => c.name === name)?.passed,
    );
    // Holdout results are withheld for every hypothesis that failed either earlier gate.
    const holdout =
      phase === "holdout" && promoted.length
        ? report(p.holdoutStart, p.holdoutEnd)
        : null;
    return {
      tier,
      development,
      validation,
      promoted,
      holdout: holdout
        ? {
            ...holdout,
            candidates: holdout.candidates.filter((c) =>
              promoted.includes(c.name),
            ),
          }
        : null,
    };
  });
  return {
    protocol: p.version,
    phase,
    asOf: asOf.toISOString(),
    sections,
    activationAllowed: false,
    limitation:
      "Decision-reference returns only; no independently verified subscriber entry prices. Missing/disabled flags do not qualify. No existing historical holdout is reused.",
  };
}
