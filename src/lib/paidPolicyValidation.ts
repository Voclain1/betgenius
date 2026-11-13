/**
 * Sprint 05: chronological comparison of VIP / PREMIUM selection policies on
 * settled history. Pure; the script supplies the rows. Diagnostic only.
 *
 * Every policy is applied to the SAME candidate universe with bars fixed in
 * advance (QUALITY_POLICY). Nothing is tuned here: the split exists so a
 * reader can see whether a policy's training-window result survives the later
 * holdout window, not to pick thresholds on it.
 *
 *   EXISTING           picks that actually carried the tier's category
 *   QUALITY_FIRST      existing paid scope, kept only if assessCandidateQuality
 *                      qualifies it at the tier's bars
 *   STRICT_PREMIUM     PREMIUM bars without the EV condition (no calibration
 *                      is active, so EV cannot be required retrospectively)
 *   DIVERSIFIED        QUALITY_FIRST, then evaluateCandidateSet per Lagos day
 *                      (duplicates, correlation, league-slot and market caps)
 *   EXPANDED_COVERAGE  QUALITY_FIRST bars applied to EVERY competition, paid
 *                      scope or not: do minor-league picks that clear the same
 *                      bars perform comparably?
 */
import { wilson95 } from "@/lib/paidMarketQuality";
import { assessCandidateQuality, evaluateCandidateSet, QUALITY_POLICY, type QualityCandidate, type QualityTier } from "@/lib/paidCandidateQuality";

export type ValidationRow = QualityCandidate & {
  outcome: "WON" | "LOST" | "VOID";
  categories: string[];
  inPaidScope: boolean;
  /** Lagos kickoff day, for per-day set evaluation. */
  day: string;
  /** Where the price came from. "entry" = recorded at publication; "closing" = last pre-kickoff quote (later than publication). */
  priceSource: "entry" | "closing" | "missing";
};

export type PolicyName = "EXISTING" | "QUALITY_FIRST" | "STRICT_PREMIUM" | "DIVERSIFIED" | "EXPANDED_COVERAGE";

export type PolicyWindow = {
  n: number; wins: number; losses: number; voids: number;
  winRate: number | null; wilson95: [number, number] | null;
  priced: number; roiPct: number | null; meanOdds: number | null;
  /** Wins minus the sum of market-implied probabilities on priced decided picks: > 0 beats the market. */
  winsOverMarket: number | null;
  topLeagueShare: number | null; maxPerDay: number;
};
export type PolicyResult = { policy: PolicyName; tier: QualityTier; training: PolicyWindow; holdout: PolicyWindow; all: PolicyWindow };

function windowStats(rows: readonly ValidationRow[]): PolicyWindow {
  const decided = rows.filter((r) => r.outcome !== "VOID");
  const wins = decided.filter((r) => r.outcome === "WON").length;
  const priced = rows.filter((r) => r.odds != null && r.odds > 1);
  const pricedDecided = priced.filter((r) => r.outcome !== "VOID");
  const ret = priced.reduce((s, r) => s + (r.outcome === "WON" ? r.odds! - 1 : r.outcome === "LOST" ? -1 : 0), 0);
  const leagues = new Map<number | null, number>();
  const days = new Map<string, number>();
  for (const r of rows) { leagues.set(r.leagueApiId, (leagues.get(r.leagueApiId) ?? 0) + 1); days.set(r.day, (days.get(r.day) ?? 0) + 1); }
  const marketSum = pricedDecided.reduce((s, r) => s + (r.marketProbability ?? 0) / 100, 0);
  return {
    n: rows.length, wins, losses: decided.length - wins, voids: rows.length - decided.length,
    winRate: decided.length ? wins / decided.length : null,
    wilson95: wilson95(wins, decided.length),
    priced: priced.length,
    roiPct: priced.length >= 30 ? (100 * ret) / priced.length : null,
    meanOdds: priced.length ? priced.reduce((s, r) => s + r.odds!, 0) / priced.length : null,
    winsOverMarket: pricedDecided.length >= 30 && pricedDecided.every((r) => r.marketProbability != null)
      ? pricedDecided.filter((r) => r.outcome === "WON").length - marketSum : null,
    topLeagueShare: rows.length ? Math.max(...leagues.values()) / rows.length : null,
    maxPerDay: days.size ? Math.max(...days.values()) : 0,
  };
}

/**
 * Split at a kickoff timestamp so the training window ends strictly before the
 * holdout begins; fixtures sharing a kickoff time never straddle the boundary.
 */
export function chronologicalSplit<T extends { kickoff: Date; id: string }>(rows: readonly T[], holdoutFraction = 0.3): { splitAt: Date | null; training: T[]; holdout: T[] } {
  const ordered = [...rows].sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || a.id.localeCompare(b.id));
  const at = ordered[Math.floor(ordered.length * (1 - holdoutFraction))]?.kickoff ?? null;
  if (!at) return { splitAt: null, training: ordered, holdout: [] };
  return { splitAt: at, training: ordered.filter((r) => r.kickoff < at), holdout: ordered.filter((r) => r.kickoff >= at) };
}

/**
 * The moment a historical candidate is judged at. With a quote: one minute
 * after it was taken, unless that is inside the minimum lead, in which case at
 * the latest allowed moment (kickoff - lead - 1 min) with the quote treated as
 * just taken. That is lenient for near-kickoff closing quotes and is disclosed
 * as such; it never moves a judgement past kickoff, so no result leaks in.
 * Without a quote: two hours before kickoff (it is rejected as unpriced anyway).
 */
export function judgedAt(r: ValidationRow): Date {
  return judgedCandidate(r).at;
}

export function judgedCandidate(r: ValidationRow): { at: Date; candidate: ValidationRow } {
  const latest = r.kickoff.getTime() - (QUALITY_POLICY.MIN_LEAD_MINUTES + 1) * 60_000;
  if (!r.quoteFetchedAt || r.quoteFetchedAt >= r.kickoff) return { at: new Date(r.kickoff.getTime() - 2 * 3_600_000), candidate: r };
  const at = r.quoteFetchedAt.getTime() + 60_000;
  if (at <= latest) return { at: new Date(at), candidate: r };
  return { at: new Date(latest), candidate: { ...r, quoteFetchedAt: new Date(latest - 60_000) } };
}

export function selectByPolicy(rows: readonly ValidationRow[], policy: PolicyName, tier: QualityTier): ValidationRow[] {
  const hasTier = (r: ValidationRow) => r.categories.includes(tier);
  const qualifies = (r: ValidationRow, t: QualityTier, bars = QUALITY_POLICY) => {
    const j = judgedCandidate(r);
    return assessCandidateQuality(j.candidate, t, j.at, bars).decision === "QUALIFIED";
  };
  switch (policy) {
    case "EXISTING":
      return rows.filter(hasTier);
    case "QUALITY_FIRST":
      return rows.filter((r) => r.inPaidScope && qualifies(r, "VIP") && (tier === "VIP" || r.confidence >= QUALITY_POLICY.PREMIUM.minConfidence));
    case "STRICT_PREMIUM": {
      // Same PREMIUM bars, with no EV requirement and judged as VIP-qualified-and-stricter.
      const p = QUALITY_POLICY.PREMIUM;
      return rows.filter((r) => r.inPaidScope && qualifies(r, "VIP")
        && r.confidence >= p.minConfidence && (r.marketProbability ?? 0) >= p.minMarket && (r.marketProbability ?? 101) <= p.maxMarket
        && Math.abs(r.confidence - (r.marketProbability ?? Infinity)) <= p.maxGapPP && (r.bookmakers ?? 0) >= p.minBookmakers);
    }
    case "DIVERSIFIED": {
      const base = selectByPolicy(rows, "QUALITY_FIRST", tier);
      const byDay = new Map<string, ValidationRow[]>();
      for (const r of base) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
      const out: ValidationRow[] = [];
      for (const dayRows of byDay.values()) {
        // Each pick already qualified on its own at its own decision time; the
        // set stage is only allowed to drop for duplication or correlation.
        const at = new Date(Math.min(...dayRows.map((r) => judgedAt(r).getTime())));
        const verdicts = evaluateCandidateSet(dayRows, "VIP", at, QUALITY_POLICY, { setRulesOnly: true });
        out.push(...dayRows.filter((_, i) => verdicts[i].decision === "QUALIFIED"));
      }
      return out;
    }
    case "EXPANDED_COVERAGE":
      return rows.filter((r) => qualifies(r, "VIP") && (tier === "VIP" || r.confidence >= QUALITY_POLICY.PREMIUM.minConfidence));
  }
}

export const POLICIES: readonly PolicyName[] = ["EXISTING", "QUALITY_FIRST", "STRICT_PREMIUM", "DIVERSIFIED", "EXPANDED_COVERAGE"];

export function comparePolicies(rows: readonly ValidationRow[], tier: QualityTier, holdoutFraction = 0.3): { splitAt: string | null; results: PolicyResult[] } {
  const { splitAt } = chronologicalSplit(rows, holdoutFraction);
  const results = POLICIES.map((policy) => {
    const picked = selectByPolicy(rows, policy, tier);
    const training = splitAt ? picked.filter((r) => r.kickoff < splitAt) : picked;
    const holdout = splitAt ? picked.filter((r) => r.kickoff >= splitAt) : [];
    return { policy, tier, training: windowStats(training), holdout: windowStats(holdout), all: windowStats(picked) };
  });
  return { splitAt: splitAt?.toISOString() ?? null, results };
}

/**
 * Missing-odds sensitivity: the same policy result if every unpriced pick had
 * lost (worst case) versus been excluded (the default ROI basis).
 */
export function missingOddsSensitivity(rows: readonly ValidationRow[]): { unpriced: number; roiExcludedPct: number | null; roiUnpricedAsLossPct: number | null } {
  const priced = rows.filter((r) => r.odds != null && r.odds > 1);
  const ret = priced.reduce((s, r) => s + (r.outcome === "WON" ? r.odds! - 1 : r.outcome === "LOST" ? -1 : 0), 0);
  const unpriced = rows.length - priced.length;
  return {
    unpriced,
    roiExcludedPct: priced.length ? (100 * ret) / priced.length : null,
    roiUnpricedAsLossPct: rows.length ? (100 * (ret - rows.filter((r) => !(r.odds != null && r.odds > 1) && r.outcome !== "VOID").length)) / rows.length : null,
  };
}
