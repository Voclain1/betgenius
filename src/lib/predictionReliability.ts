/** Sprint 06 research primitives. No live admission, environment activation or I/O. */
import {
  brier,
  logLoss,
  expectedCalibrationError,
  type Outcome01,
} from "./calibration";
import { wilson95 } from "./paidMarketQuality";

export const RELIABILITY_VERSION = "reliability-s06-v1";
export const RESEARCH_POLICIES = [
  "calibrated",
  "lower-bound-value",
  "structural-diversification",
] as const;
export const RELIABILITY_LIMITS = {
  minPooled: 200,
  minMarket: 100,
  minBin: 40,
  staleDays: 30,
  quoteMinutes: 120,
} as const;
const validDate = (d: Date) =>
  d instanceof Date && Number.isFinite(d.getTime());
const probability = (p: number) => Number.isFinite(p) && p >= 0 && p <= 1;

export type ReliabilityRow = {
  id: string;
  fixture: string;
  market: string;
  competition: number | null;
  decisionAt: Date;
  kickoff: Date;
  settledAt: Date;
  raw: number;
  outcome: Outcome01;
};
export type ReliabilityBin = {
  lower: number;
  n: number;
  wins: number;
  p: number;
  interval: [number, number];
};
export type ReliabilityModel = {
  version: string;
  fittedAt: string;
  cutoff: string;
  expiresAt: string;
  method: "pooled-reliability-bins";
  n: number;
  pooled: ReliabilityBin[];
  markets: Record<string, ReliabilityBin[]>;
};

/** Outcomes must have been known before the training cutoff; duplicate fixtures/markets cannot inflate n. */
export function fitReliability(
  rows: readonly ReliabilityRow[],
  cutoff: Date,
  version: string,
): ReliabilityModel | null {
  if (!validDate(cutoff) || !version.trim())
    throw new Error("Invalid calibration identity");
  const seen = new Set<string>();
  const train = [...rows]
    .sort(
      (a, b) =>
        a.decisionAt.getTime() - b.decisionAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .filter((r) => {
      const key = JSON.stringify([r.fixture, r.market]);
      if (
        !validDate(r.decisionAt) ||
        !validDate(r.kickoff) ||
        !validDate(r.settledAt) ||
        !probability(r.raw) ||
        !["MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS"].includes(
          r.market,
        ) ||
        (r.outcome !== 0 && r.outcome !== 1) ||
        r.decisionAt >= r.kickoff ||
        r.kickoff > r.settledAt ||
        r.settledAt >= cutoff ||
        seen.has(key)
      )
        return false;
      seen.add(key);
      return true;
    });
  if (train.length < RELIABILITY_LIMITS.minPooled) return null;
  const bins = (rs: ReliabilityRow[]): ReliabilityBin[] =>
    Array.from({ length: 5 }, (_, i) => {
      const group = rs.filter((r) => Math.min(4, Math.floor(r.raw * 5)) === i);
      const wins = group.reduce((s, r) => s + r.outcome, 0);
      return {
        lower: i / 5,
        n: group.length,
        wins,
        p: group.length ? wins / group.length : 0,
        interval: wilson95(wins, group.length) ?? [0, 1],
      } as ReliabilityBin;
    });
  const markets: Record<string, ReliabilityBin[]> = {};
  for (const market of new Set(train.map((r) => r.market))) {
    const group = train.filter((r) => r.market === market);
    if (group.length >= RELIABILITY_LIMITS.minMarket)
      markets[market] = bins(group);
  }
  return {
    version,
    fittedAt: cutoff.toISOString(),
    cutoff: cutoff.toISOString(),
    expiresAt: new Date(
      +cutoff + RELIABILITY_LIMITS.staleDays * 86400000,
    ).toISOString(),
    method: "pooled-reliability-bins",
    n: train.length,
    pooled: bins(train),
    markets,
  };
}

export type ReliabilityEstimate = {
  status: "UNCALIBRATED" | "STALE" | "EVALUATION_ONLY";
  version: string | null;
  p: number | null;
  lower: number | null;
  upper: number | null;
  n: number;
  scope: "market" | "pooled" | null;
};
/** A fitted model is a research estimate, never evidence of out-of-sample calibration by itself. */
export function estimateReliability(
  model: ReliabilityModel | null,
  raw: number,
  market: string,
  at: Date,
): ReliabilityEstimate {
  const empty: ReliabilityEstimate = {
    status: "UNCALIBRATED",
    version: model?.version ?? null,
    p: null,
    lower: null,
    upper: null,
    n: 0,
    scope: null,
  };
  if (
    !model ||
    !probability(raw) ||
    !validDate(at) ||
    !Number.isFinite(Date.parse(model.cutoff)) ||
    !Number.isFinite(Date.parse(model.expiresAt)) ||
    +at <= Date.parse(model.cutoff)
  )
    return empty;
  if (+at > Date.parse(model.expiresAt)) return { ...empty, status: "STALE" };
  const index = Math.min(4, Math.floor(raw * 5));
  const local = model.markets[market]?.[index];
  const useLocal = !!local && local.n >= RELIABILITY_LIMITS.minBin;
  const bin = useLocal ? local : model.pooled[index];
  if (
    !bin ||
    bin.n < RELIABILITY_LIMITS.minBin ||
    !probability(bin.p) ||
    !bin.interval.every(probability)
  )
    return empty;
  return {
    status: "EVALUATION_ONLY",
    version: model.version,
    p: bin.p,
    lower: bin.interval[0],
    upper: bin.interval[1],
    n: bin.n,
    scope: useLocal ? "market" : "pooled",
  };
}

export type DirectQuote = {
  bookmaker: string;
  market: string;
  selection: string;
  odds: number;
  observedAt: string;
  providerUpdatedAt: string | null;
  source: "api-football";
  suspended: boolean | null; // null = provider did not supply suspension evidence
};
export type PriceEvidence = {
  status:
    | "VALID"
    | "MISSING_PRICE"
    | "INVALID_PRICE"
    | "STALE_PRICE"
    | "INSUFFICIENT_EVIDENCE";
  quotes: DirectQuote[];
  median: number | null;
  dispersion: number | null;
  reasons: string[];
  role: "decision-reference";
  executableEntry: false;
};
/** Validate exact market/selection, both clocks, provenance and independent bookmaker identity. */
export function auditPrices(
  quotes: readonly DirectQuote[],
  market: string,
  selection: string,
  at: Date,
  kickoff: Date,
): PriceEvidence {
  const reasons = new Set<string>();
  const accepted: DirectQuote[] = [];
  const books = new Set<string>();
  for (const q of quotes) {
    if (q.market !== market || q.selection !== selection) {
      reasons.add("MARKET_SELECTION_MISMATCH");
      continue;
    }
    if (
      !q.bookmaker.trim() ||
      q.source !== "api-football" ||
      !Number.isFinite(q.odds) ||
      q.odds <= 1 ||
      q.odds > 1000 ||
      q.suspended === true
    ) {
      reasons.add("INVALID_OR_SUSPENDED");
      continue;
    }
    const observed = Date.parse(q.observedAt),
      updated = Date.parse(q.providerUpdatedAt ?? "");
    if (
      !validDate(at) ||
      !validDate(kickoff) ||
      !Number.isFinite(observed) ||
      !Number.isFinite(updated) ||
      updated > observed ||
      observed > +at ||
      +at >= +kickoff ||
      observed >= +kickoff ||
      +at - updated > RELIABILITY_LIMITS.quoteMinutes * 60000
    ) {
      reasons.add("STALE_OR_UNVERIFIABLE_CLOCK");
      continue;
    }
    const key = q.bookmaker.trim().toLowerCase();
    if (books.has(key)) {
      reasons.add("DUPLICATE_BOOKMAKER");
      continue;
    }
    books.add(key);
    accepted.push(q);
  }
  const ordered = accepted.map((q) => q.odds).sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  const median = ordered.length
    ? (ordered[mid] + ordered[Math.floor((ordered.length - 1) / 2)]) / 2
    : null;
  const dispersion = median
    ? ordered[ordered.length - 1] / ordered[0] - 1
    : null;
  if (dispersion != null && dispersion > 0.15)
    reasons.add("SUSPICIOUS_DISPERSION");
  const status = !quotes.length
    ? "MISSING_PRICE"
    : !accepted.length
      ? reasons.has("STALE_OR_UNVERIFIABLE_CLOCK")
        ? "STALE_PRICE"
        : "INVALID_PRICE"
      : accepted.length < 3 || reasons.has("SUSPICIOUS_DISPERSION")
        ? "INSUFFICIENT_EVIDENCE"
        : "VALID";
  return {
    status,
    quotes: accepted,
    median,
    dispersion,
    reasons: [...reasons].sort(),
    role: "decision-reference",
    executableEntry: false,
  };
}

/** Only mutually exclusive, exhaustive outcomes from the SAME bookmaker/line form an overround. */
export function bookmakerOverround(
  odds: readonly number[],
  expectedOutcomes: number,
): number | null {
  if (
    !Number.isInteger(expectedOutcomes) ||
    expectedOutcomes < 2 ||
    odds.length !== expectedOutcomes ||
    odds.some((o) => !Number.isFinite(o) || o <= 1)
  )
    return null;
  return odds.reduce((s, o) => s + 1 / o, 0) - 1;
}
export function researchValue(
  estimate: ReliabilityEstimate,
  price: PriceEvidence,
  market: string,
) {
  let status: string = "UNCALIBRATED";
  let ev: number | null = null,
    lower: number | null = null;
  if (price.status !== "VALID") status = price.status;
  else if (
    !["MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS"].includes(market)
  )
    status = "INSUFFICIENT_EVIDENCE";
  else if (
    estimate.status === "EVALUATION_ONLY" &&
    estimate.p != null &&
    estimate.lower != null &&
    price.median != null
  ) {
    ev = estimate.p * price.median - 1;
    lower = estimate.lower * price.median - 1;
    // No fitted model is promoted by this module. Positive EV is only a hypothesis.
    status = lower > 0 ? "POSSIBLE_VALUE" : "NO_DEMONSTRATED_VALUE";
  }
  return {
    status,
    expectedReturn: ev,
    lowerExpectedReturn: lower,
    activationAllowed: false as const,
  };
}

export type RiskCandidate = {
  id: string;
  fixture: string;
  market: string;
  selection: string;
  competition: number | null;
  confidence: number;
  odds: number | null;
  teams?: number[];
};
export function structuralRisk(rows: readonly RiskCandidate[]) {
  const warnings: Array<{ id: string; relatedId: string; reason: string }> = [];
  const counts = {
    market: {} as Record<string, number>,
    competition: {} as Record<string, number>,
    confidence: {} as Record<string, number>,
    odds: {} as Record<string, number>,
  };
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    for (let j = 0; j < i; j++) {
      const b = rows[j];
      let reason: string | null = null;
      if (
        a.id === b.id ||
        (a.fixture === b.fixture &&
          a.market === b.market &&
          a.selection === b.selection)
      )
        reason = "DUPLICATE_SELECTION";
      else if (a.fixture === b.fixture) {
        // Different labels may overlap (e.g. over 1.5 and over 2.5); only exact opposing binary labels contradict.
        const opposite =
          a.market === b.market &&
          ((a.market === "MATCH_WINNER" && a.selection !== b.selection) ||
            (a.market === "BTTS" &&
              new Set([a.selection, b.selection]).has("YES") &&
              new Set([a.selection, b.selection]).has("NO")));
        reason = opposite ? "DIRECT_CONTRADICTION" : "SAME_FIXTURE_DEPENDENCE";
      } else if (a.teams?.some((t) => b.teams?.includes(t)))
        reason = "SHARED_TEAM";
      if (reason) warnings.push({ id: a.id, relatedId: b.id, reason });
    }
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    for (const [key, value] of [
      ["market", a.market],
      ["competition", String(a.competition ?? "unknown")],
      ["confidence", String(Math.floor(a.confidence / 10) * 10)],
      [
        "odds",
        a.odds == null ? "unknown" : a.odds < 1.5 ? "under1.5" : "1.5plus",
      ],
    ] as const)
      counts[key][value] = (counts[key][value] ?? 0) + 1;
  }
  return {
    warnings,
    counts,
    numericalCorrelation: null,
    combinedProbability: null,
    activationAllowed: false as const,
  };
}

/** Descriptive metrics only: VOID/push markets require a conditional-outcome model. */
export function reliabilityMetrics(
  rows: readonly { raw: number; outcome: Outcome01 }[],
) {
  const valid = rows.filter(
    (r) => probability(r.raw) && (r.outcome === 0 || r.outcome === 1),
  );
  const ps = valid.map((r) => r.raw),
    ys = valid.map((r) => r.outcome);
  const wins = ys.reduce((s: number, y) => s + y, 0),
    n = valid.length;
  return {
    n,
    excluded: rows.length - n,
    wins,
    winInterval: wilson95(wins, n),
    meanConfidence: n ? ps.reduce((s, p) => s + p, 0) / n : null,
    winRate: n ? wins / n : null,
    brier: n ? brier(ps, ys) : null,
    logLoss: n ? logLoss(ps, ys) : null,
    ece: n ? expectedCalibrationError(ps, ys) : null,
    sufficient: n >= 100,
  };
}
