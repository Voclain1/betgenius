/**
 * Sprint 05: candidate-quality decisions for VIP / PREMIUM. SHADOW ONLY.
 *
 * Nothing here admits, removes or orders a live pick. Paid curation keeps the
 * #175 market-confirmation rule; this module explains, per candidate, what a
 * stricter quality-first policy would have done and why, so the policy can be
 * judged on point-in-time records before anyone proposes to activate it.
 *
 * Every number used is one the pipeline already holds at decision time:
 *   - model probability    the prediction's stated confidence (uncalibrated)
 *   - market probability   the de-vigged median quote (PricedPick.fair)
 *   - uncertainty          the calibrated lower bound when a calibration is
 *                          active; otherwise "uncalibrated", never invented
 *   - estimated value      the lower-bound EV from paidValue, only when
 *                          calibrated; null otherwise
 *   - quote age, bookmaker count, lead time to kickoff
 * Reputation, league prestige and historical win rate are NOT inputs.
 *
 * Decisions are evaluated in a fixed order and the first failure is the
 * decision; every failed check is still listed in `reasons`.
 */
export type CandidateDecision =
  | "QUALIFIED"
  | "SHADOW_ONLY"
  | "REJECTED_DUPLICATE"
  | "REJECTED_TOO_CLOSE_TO_KICKOFF"
  | "REJECTED_INSUFFICIENT_DATA"
  | "REJECTED_MISSING_PRICE"
  | "REJECTED_STALE_DATA"
  | "REJECTED_INVALID_PRICE"
  | "REJECTED_LOW_CONFIDENCE"
  | "REJECTED_LOW_VALUE_EVIDENCE"
  | "REJECTED_CORRELATED_SELECTION";

export type QualityTier = "VIP" | "PREMIUM";

export type QualityCandidate = {
  id: string;
  /** Fixture identity (paidFixtureKey or matchKey). */
  fixtureKey: string;
  leagueApiId: number | null;
  marketType: string;
  /** Normalised selection label, used for duplicate / contradiction detection. */
  selection: string;
  kickoff: Date;
  /** Stated model confidence, 0-100. */
  confidence: number;
  /** Median decimal price; null when no usable quote. */
  odds: number | null;
  /** De-vigged market probability 0-100; null when the market is not fully quoted. */
  marketProbability: number | null;
  bookmakers: number | null;
  /** True when the price is derived (draw no bet from the 1X2), not quoted. */
  derivedPrice: boolean;
  quoteFetchedAt: Date | null;
  /** Calibrated lower-bound win probability 0-1, null when uncalibrated. */
  calibratedLower: number | null;
  /** Lower-bound EV per unit, null when uncalibrated or unpriced. */
  expectedValueLower: number | null;
  /** Optional feature evidence. Absent means unknown, which is not held against the pick. */
  evidence?: { formMatches?: number | null; standingsKnown?: boolean | null };
};

/** The proposed bars. Fixed in advance and documented; never tuned on the holdout. */
export const QUALITY_POLICY = {
  MIN_LEAD_MINUTES: 60, // = PAID_MIN_PUBLISH_LEAD_MS
  MAX_QUOTE_AGE_MINUTES: 120, // the market-confirmation gate's freshness bar
  MIN_ODDS: 1.05,
  VIP: { minConfidence: 75, minMarket: 75, maxMarket: 87, maxGapPP: 10, minBookmakers: 5 },
  // PREMIUM is not "VIP with a higher number": it needs a deeper book, a
  // tighter model/market agreement, and calibrated value evidence. Without an
  // active calibration no candidate can be a proposed PREMIUM; it is reported
  // SHADOW_ONLY instead.
  PREMIUM: { minConfidence: 80, minMarket: 80, maxMarket: 87, maxGapPP: 6, minBookmakers: 8, minEvLower: 0 },
  MIN_FORM_MATCHES: 3,
  /** Diversification: at most this many qualified picks per league per kickoff slot. */
  MAX_PER_LEAGUE_SLOT: 2,
  SLOT_MINUTES: 120,
  /** And no single market type above this share of the qualified set (when the set has 4+). */
  MAX_MARKET_SHARE: 0.5,
} as const;

export type QualityVerdict = {
  id: string;
  tier: QualityTier;
  decision: CandidateDecision;
  reasons: CandidateDecision[];
  features: {
    modelProbability: number;
    marketProbability: number | null;
    gapPP: number | null;
    bookmakers: number | null;
    quoteAgeMinutes: number | null;
    leadMinutes: number;
    calibrated: boolean;
    expectedValueLower: number | null;
  };
};

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** One candidate against one tier's bars, ignoring the set (no duplicate / correlation checks). */
export function assessCandidateQuality(c: QualityCandidate, tier: QualityTier, now: Date, policy = QUALITY_POLICY): QualityVerdict {
  const bar = policy[tier];
  const reasons: CandidateDecision[] = [];
  const leadMinutes = Math.floor((c.kickoff.getTime() - now.getTime()) / 60_000);
  const quoteAge = c.quoteFetchedAt && finite(c.quoteFetchedAt.getTime()) ? Math.floor((now.getTime() - c.quoteFetchedAt.getTime()) / 60_000) : null;
  const gapPP = finite(c.marketProbability) && finite(c.confidence) ? Math.abs(c.confidence - c.marketProbability) : null;
  const calibrated = finite(c.calibratedLower);

  if (!finite(c.kickoff.getTime()) || leadMinutes < policy.MIN_LEAD_MINUTES) reasons.push("REJECTED_TOO_CLOSE_TO_KICKOFF");
  if (!finite(c.confidence) || c.confidence < 0 || c.confidence > 100
    || (c.evidence?.formMatches != null && c.evidence.formMatches < policy.MIN_FORM_MATCHES)
    || (c.evidence?.standingsKnown === false && c.marketType === "MATCH_WINNER")) reasons.push("REJECTED_INSUFFICIENT_DATA");
  if (c.odds == null || c.marketProbability == null || c.derivedPrice) reasons.push("REJECTED_MISSING_PRICE");
  else {
    if (quoteAge == null || quoteAge < 0 || quoteAge > policy.MAX_QUOTE_AGE_MINUTES || (c.quoteFetchedAt && c.quoteFetchedAt >= c.kickoff)) reasons.push("REJECTED_STALE_DATA");
    if (!finite(c.odds) || c.odds < policy.MIN_ODDS || (c.bookmakers ?? 0) < bar.minBookmakers
      || c.marketProbability < 0 || c.marketProbability > 100) reasons.push("REJECTED_INVALID_PRICE");
  }
  if (finite(c.confidence) && c.confidence < bar.minConfidence) reasons.push("REJECTED_LOW_CONFIDENCE");
  if (c.marketProbability != null && (c.marketProbability < bar.minMarket || c.marketProbability > bar.maxMarket || (gapPP ?? 0) > bar.maxGapPP)) {
    reasons.push("REJECTED_LOW_VALUE_EVIDENCE");
  }
  if (tier === "PREMIUM" && calibrated && !(finite(c.expectedValueLower) && c.expectedValueLower >= policy.PREMIUM.minEvLower)) {
    reasons.push("REJECTED_LOW_VALUE_EVIDENCE");
  }

  const unique = [...new Set(reasons)];
  const decision: CandidateDecision = unique[0] ?? (tier === "PREMIUM" && !calibrated ? "SHADOW_ONLY" : "QUALIFIED");
  return {
    id: c.id, tier, decision, reasons: unique.length ? unique : [decision],
    features: {
      modelProbability: c.confidence, marketProbability: c.marketProbability, gapPP: gapPP == null ? null : Math.round(gapPP * 10) / 10,
      bookmakers: c.bookmakers, quoteAgeMinutes: quoteAge, leadMinutes, calibrated, expectedValueLower: c.expectedValueLower,
    },
  };
}

const marketFamily = (marketType: string) => marketType.trim().toUpperCase();

/**
 * A whole candidate set for one tier: per-candidate verdicts, then duplicates
 * (same fixture and market; the stronger candidate is kept), contradictions
 * (same fixture and market, different selection: both rejected) and
 * diversification (league-slot and market-share caps) over what qualified,
 * strongest first. Deterministic: ties break on id.
 */
export function evaluateCandidateSet(
  candidates: readonly QualityCandidate[],
  tier: QualityTier,
  now: Date,
  policy = QUALITY_POLICY,
  /** setRulesOnly: skip the per-candidate checks (already applied at each candidate's own decision time). */
  opts: { setRulesOnly?: boolean } = {},
): QualityVerdict[] {
  // Keyed by position, not id: two candidates sharing an id are two entries.
  const verdicts = candidates.map((c) => {
    const v = assessCandidateQuality(c, tier, now, policy);
    return opts.setRulesOnly ? { ...v, decision: "QUALIFIED" as CandidateDecision, reasons: ["QUALIFIED" as CandidateDecision] } : v;
  });
  const strength = (c: QualityCandidate) => [c.expectedValueLower ?? -Infinity, c.marketProbability ?? -Infinity, c.confidence] as const;
  const ordered = candidates.map((c, i) => ({ c, i })).sort((x, y) => {
    const sa = strength(x.c), sb = strength(y.c);
    return sb[0] - sa[0] || sb[1] - sa[1] || sb[2] - sa[2] || x.c.id.localeCompare(y.c.id) || x.i - y.i;
  });
  const reject = (i: number, why: CandidateDecision) => {
    const v = verdicts[i];
    v.reasons = [...new Set([why, ...v.reasons.filter((r) => r !== "QUALIFIED" && r !== "SHADOW_ONLY")])];
    v.decision = why;
  };

  // Duplicates and contradictions on the same fixture and market.
  const seenIds = new Set<string>();
  const byMarket = new Map<string, Array<{ c: QualityCandidate; i: number }>>();
  for (const e of ordered) {
    if (seenIds.has(e.c.id)) { reject(e.i, "REJECTED_DUPLICATE"); continue; }
    seenIds.add(e.c.id);
    const k = `${e.c.fixtureKey}|${marketFamily(e.c.marketType)}`;
    byMarket.set(k, [...(byMarket.get(k) ?? []), e]);
  }
  for (const group of byMarket.values()) {
    if (group.length < 2) continue;
    const selections = new Set(group.map((g) => g.c.selection.trim().toUpperCase()));
    if (selections.size > 1) { for (const g of group) reject(g.i, "REJECTED_CORRELATED_SELECTION"); continue; }
    for (const g of group.slice(1)) reject(g.i, "REJECTED_DUPLICATE");
  }

  // Diversification over what is still standing, strongest first.
  const standing = ordered.filter((e) => verdicts[e.i].decision === "QUALIFIED" || verdicts[e.i].decision === "SHADOW_ONLY");
  const slotCount = new Map<string, number>();
  const marketCount = new Map<string, number>();
  const fixtureTaken = new Set<string>();
  const marketCap = Math.max(2, Math.floor(standing.length * policy.MAX_MARKET_SHARE));
  for (const { c, i } of standing) {
    const slot = `${c.leagueApiId ?? "?"}|${Math.floor(c.kickoff.getTime() / (policy.SLOT_MINUTES * 60_000))}`;
    const m = marketFamily(c.marketType);
    const overSlot = (slotCount.get(slot) ?? 0) >= policy.MAX_PER_LEAGUE_SLOT;
    const overMarket = standing.length >= 4 && (marketCount.get(m) ?? 0) + 1 > marketCap;
    // A second pick on a fixture already taken is correlated with it (one paid pick per fixture).
    if (fixtureTaken.has(c.fixtureKey) || overSlot || overMarket) { reject(i, "REJECTED_CORRELATED_SELECTION"); continue; }
    fixtureTaken.add(c.fixtureKey);
    slotCount.set(slot, (slotCount.get(slot) ?? 0) + 1);
    marketCount.set(m, (marketCount.get(m) ?? 0) + 1);
  }
  return verdicts;
}

/** Counts per decision, for the shadow log and the admin page. */
export function tallyDecisions(verdicts: readonly QualityVerdict[]): Partial<Record<CandidateDecision, number>> {
  const out: Partial<Record<CandidateDecision, number>> = {};
  for (const v of verdicts) out[v.decision] = (out[v.decision] ?? 0) + 1;
  return out;
}

/**
 * The proposed hierarchy for one candidate: PREMIUM if it qualifies at the
 * PREMIUM bars, else VIP if it qualifies at VIP's, else none. Diagnostic only.
 */
export function proposedTier(c: QualityCandidate, now: Date, policy = QUALITY_POLICY): { tier: QualityTier | null; vip: QualityVerdict; premium: QualityVerdict } {
  const premium = assessCandidateQuality(c, "PREMIUM", now, policy);
  const vip = assessCandidateQuality(c, "VIP", now, policy);
  return { tier: premium.decision === "QUALIFIED" ? "PREMIUM" : vip.decision === "QUALIFIED" ? "VIP" : null, vip, premium };
}

/**
 * Build a QualityCandidate from what paid curation already assessed (no new
 * reads). The quote time is reconstructed from the recorded quote age at the
 * same `now`, so it is exactly the quote the live rule saw.
 */
export function qualityCandidateFromAssessment(
  a: { id: string; fixtureKey: string; leagueApiId: number | null; marketType: string; rawConfidence: number; quoteAgeMinutes: number | null;
    value: { odds: number | null; marketProbability: number | null; bookmakers: number | null; estimatedProbabilityLower: number | null; expectedValueLower: number | null; reasons: readonly string[] } },
  row: { kickoff: Date | null; selection?: unknown } | undefined,
  now: Date,
): QualityCandidate | null {
  if (!row?.kickoff) return null;
  return {
    id: a.id,
    fixtureKey: a.fixtureKey,
    leagueApiId: a.leagueApiId,
    marketType: a.marketType,
    selection: typeof row.selection === "string" ? row.selection : JSON.stringify(row.selection ?? null),
    kickoff: row.kickoff,
    confidence: a.rawConfidence,
    odds: a.value.odds,
    marketProbability: a.value.marketProbability,
    bookmakers: a.value.bookmakers,
    // paidValue never carries a derived price as odds (it is NO_EXECUTABLE_PRICE,
    // odds null), so a derived price already lands on REJECTED_MISSING_PRICE.
    derivedPrice: false,
    quoteFetchedAt: a.quoteAgeMinutes == null ? null : new Date(now.getTime() - a.quoteAgeMinutes * 60_000),
    calibratedLower: a.value.estimatedProbabilityLower,
    expectedValueLower: a.value.expectedValueLower,
  };
}

/** Version tag written with every shadow quality record, so evidence is never mixed across policy revisions. */
export const QUALITY_POLICY_VERSION = "quality-s05-v1";

/** The shadow-log payload for one curation run. Pure. */
export function shadowQualityRecord(
  assessments: Parameters<typeof qualityCandidateFromAssessment>[0][],
  rowsById: Map<string, { kickoff: Date | null; selection?: unknown }>,
  tier: QualityTier,
  now: Date,
  selectedIds: readonly string[],
) {
  const candidates = assessments.map((a) => qualityCandidateFromAssessment(a, rowsById.get(a.id), now)).filter((c): c is QualityCandidate => c !== null);
  const verdicts = evaluateCandidateSet(candidates, tier, now);
  const selected = new Set(selectedIds);
  const proposed = { PREMIUM: 0, VIP: 0, none: 0 };
  for (const c of candidates) proposed[proposedTier(c, now).tier ?? "none"]++;
  // Prospective hypotheses (Sprint 05 continuation): formed from the
  // development-period diagnosis, so they may only be judged on records
  // written AFTER this version, never on the history that suggested them.
  const prospective = candidates.map((c) => ({
    id: c.id,
    marketBelow75: c.marketProbability != null && c.marketProbability < 75,
    odds150Plus: c.odds != null && c.odds >= 1.5,
    marketAtLeast87: c.marketProbability != null && c.marketProbability >= 87,
  }));
  const liveSelectedRejected = verdicts.filter((v) => selected.has(v.id) && v.decision !== "QUALIFIED" && v.decision !== "SHADOW_ONLY").length;
  return {
    policyVersion: QUALITY_POLICY_VERSION,
    tier,
    activation: "SHADOW_ONLY" as const,
    candidates: candidates.length,
    decisions: tallyDecisions(verdicts),
    proposedTiers: proposed,
    liveSelectedRejected,
    prospectiveFlags: {
      version: "prospective-s05-v1",
      marketBelow75: prospective.filter((p) => p.marketBelow75).length,
      odds150Plus: prospective.filter((p) => p.odds150Plus).length,
      marketAtLeast87: prospective.filter((p) => p.marketAtLeast87).length,
      byId: prospective.filter((p) => p.marketBelow75 || p.odds150Plus || p.marketAtLeast87),
    },
    verdicts: verdicts.map((v, i) => ({ id: v.id, leagueApiId: candidates[i]?.leagueApiId ?? null, decision: v.decision, reasons: v.reasons, features: v.features, liveSelected: selected.has(v.id) })),
  };
}
