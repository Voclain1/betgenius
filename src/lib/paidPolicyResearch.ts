/**
 * Sprint 05 continuation: why the first quality filter underperformed, and
 * whether any alternative credibly beats the existing VIP / PREMIUM selection.
 * Pure; scripts/research-paid-policy.ts supplies the rows.
 *
 * DISCIPLINE
 *   - Three chronological periods: dev-train, dev-validate, final holdout.
 *     Diagnosis and exploration read the development period ONLY.
 *   - Every hypothesis is a SUBSET of the existing selection. It can only
 *     remove picks, never add one, so it cannot let a weaker fixture displace
 *     a selected one.
 *   - Promotion rule (PROMOTION, below), fixed in advance and applied on
 *     dev-validate with dev-train as a sign check. Only promoted hypotheses
 *     are scored on the final holdout, once, next to the baseline. Holdout
 *     figures for the others are never computed.
 *   - Returns use the last PRE-KICKOFF quote (a closing reference). They are
 *     not subscriber entry prices and are never called realized returns.
 */
import { evaluateCandidateSet, QUALITY_POLICY, type QualityTier } from "@/lib/paidCandidateQuality";
import { selectByPolicy, windowStats, judgedAt, type PolicyWindow, type ValidationRow } from "@/lib/paidPolicyValidation";

export type Period = "devTrain" | "devValidate" | "holdout";

/** Split by kickoff into three periods; fixtures sharing a kickoff never straddle a boundary. */
export function threeWaySplit<T extends { kickoff: Date; id: string }>(rows: readonly T[], fractions = { devTrain: 0.5, devValidate: 0.2 }): Record<Period, T[]> & { boundaries: [string | null, string | null] } {
  const ordered = [...rows].sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || a.id.localeCompare(b.id));
  const at = (f: number) => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * f))]?.kickoff ?? null;
  const b1 = at(fractions.devTrain);
  const b2 = at(fractions.devTrain + fractions.devValidate);
  if (!b1 || !b2) return { devTrain: ordered, devValidate: [], holdout: [], boundaries: [null, null] };
  return {
    devTrain: ordered.filter((r) => r.kickoff < b1),
    devValidate: ordered.filter((r) => r.kickoff >= b1 && r.kickoff < b2),
    holdout: ordered.filter((r) => r.kickoff >= b2),
    boundaries: [b1.toISOString(), b2.toISOString()],
  };
}

// ── Diagnosis ───────────────────────────────────────────────────────────────

export type Segment = { key: string; stats: PolicyWindow };
const seg = (key: string, rows: readonly ValidationRow[]): Segment => ({ key, stats: windowStats(rows) });
const priced = (r: ValidationRow) => r.odds != null && r.odds > 1;

/** Where the first quality filter's picks came from, relative to the existing selection. */
export function overlapDecomposition(universe: readonly ValidationRow[], tier: QualityTier): Segment[] {
  const existing = new Set(selectByPolicy(universe, "EXISTING", tier).map((r) => r.id));
  const qf = new Set(selectByPolicy(universe, "QUALITY_FIRST", tier).map((r) => r.id));
  return [
    seg("both (existing ∩ quality-first)", universe.filter((r) => existing.has(r.id) && qf.has(r.id))),
    seg("existing only (removed by quality-first)", universe.filter((r) => existing.has(r.id) && !qf.has(r.id))),
    seg("quality-first only (added from outside the feed)", universe.filter((r) => !existing.has(r.id) && qf.has(r.id))),
  ];
}

export function byOddsBand(rows: readonly ValidationRow[]): Segment[] {
  const band = (o: number | null) => (o == null ? "unpriced" : o < 1.15 ? "<1.15" : o < 1.3 ? "1.15–1.29" : o < 1.5 ? "1.30–1.49" : "≥1.50");
  return groupBy(rows, (r) => band(r.odds));
}
export function byMarketBand(rows: readonly ValidationRow[]): Segment[] {
  const band = (m: number | null) => (m == null ? "unpriced" : m < 75 ? "<75%" : m <= 87 ? "75–87%" : "≥87%");
  return groupBy(rows, (r) => band(r.marketProbability));
}
export function byConfidenceBand(rows: readonly ValidationRow[]): Segment[] {
  const band = (c: number) => (c < 80 ? "75–79" : c < 85 ? "80–84" : c < 90 ? "85–89" : "90+");
  return groupBy(rows, (r) => band(r.confidence));
}
export function byKey(rows: readonly ValidationRow[], key: (r: ValidationRow) => string, minN = 0): Segment[] {
  return groupBy(rows, key).filter((s) => s.stats.n >= minN);
}
function groupBy(rows: readonly ValidationRow[], f: (r: ValidationRow) => string): Segment[] {
  const m = new Map<string, ValidationRow[]>();
  for (const r of rows) m.set(f(r), [...(m.get(f(r)) ?? []), r]);
  return [...m.entries()].map(([k, v]) => seg(k, v)).sort((a, b) => a.key.localeCompare(b.key));
}

/** Stated confidence vs realized win rate, and Brier score of model vs market on the same priced, decided rows. */
export function calibration(rows: readonly ValidationRow[]) {
  const decided = rows.filter((r) => r.outcome !== "VOID");
  const bands = byConfidenceBand(decided).map((s) => {
    const inBand = decided.filter((r) => (r.confidence < 80 ? "75–79" : r.confidence < 85 ? "80–84" : r.confidence < 90 ? "85–89" : "90+") === s.key);
    const stated = inBand.reduce((a, r) => a + r.confidence, 0) / Math.max(1, inBand.length) / 100;
    return { band: s.key, n: inBand.length, stated, realized: s.stats.winRate, gap: s.stats.winRate == null ? null : s.stats.winRate - stated };
  });
  const both = decided.filter((r) => r.marketProbability != null);
  const brier = (p: (r: ValidationRow) => number) => (both.length ? both.reduce((a, r) => a + (p(r) - (r.outcome === "WON" ? 1 : 0)) ** 2, 0) / both.length : null);
  return { bands, brierModel: brier((r) => r.confidence / 100), brierMarket: brier((r) => (r.marketProbability as number) / 100), brierN: both.length };
}

/** Do picks that share a league and kickoff slot with 2+ others fare differently from isolated ones? */
export function clusterEffect(rows: readonly ValidationRow[]): Segment[] {
  const slot = (r: ValidationRow) => `${r.leagueApiId}|${Math.floor(r.kickoff.getTime() / (QUALITY_POLICY.SLOT_MINUTES * 60_000))}`;
  const size = new Map<string, number>();
  for (const r of rows) size.set(slot(r), (size.get(slot(r)) ?? 0) + 1);
  return groupBy(rows, (r) => ((size.get(slot(r)) ?? 1) >= 3 ? "slot of 3+" : (size.get(slot(r)) ?? 1) === 2 ? "slot of 2" : "isolated"));
}

// ── Hypotheses (subsets of the existing selection) ─────────────────────────

export type HypothesisName = "H1_PRICED_ONLY" | "H2_MODEL_MARKET_AGREEMENT" | "H3_NO_ULTRA_SHORT" | "H4_DIVERSIFIED" | "H5_COMBINED_H2_H4";

export const HYPOTHESES: Record<HypothesisName, { rationale: string; keep: (rows: readonly ValidationRow[]) => ValidationRow[] }> = {
  H1_PRICED_ONLY: {
    rationale: "Missing price evidence: keep only picks with a pre-kickoff quote for the exact selection.",
    keep: (rows) => rows.filter(priced),
  },
  H2_MODEL_MARKET_AGREEMENT: {
    rationale: "Replace narrow market bands with a single agreement check: drop a priced pick whose stated confidence and the market differ by more than 10pp. Unpriced picks are kept (no evidence either way).",
    keep: (rows) => rows.filter((r) => r.marketProbability == null || Math.abs(r.confidence - r.marketProbability) <= 10),
  },
  H3_NO_ULTRA_SHORT: {
    rationale: "Removal of higher-priced picks hurt the first filter; test the opposite end: drop picks priced under 1.10 (market ≥ ~91%), where one loss costs ten wins.",
    keep: (rows) => rows.filter((r) => r.odds == null || r.odds >= 1.1),
  },
  H4_DIVERSIFIED: {
    rationale: "Correlation: per Lagos day, one pick per fixture and at most 2 per league kickoff slot, strongest first. Nothing else changes.",
    keep: (rows) => {
      const byDay = new Map<string, ValidationRow[]>();
      for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
      const out: ValidationRow[] = [];
      for (const day of byDay.values()) {
        const at = new Date(Math.min(...day.map((r) => judgedAt(r).getTime())));
        const v = evaluateCandidateSet(day, "VIP", at, { ...QUALITY_POLICY, MAX_MARKET_SHARE: 1 } as unknown as typeof QUALITY_POLICY, { setRulesOnly: true });
        out.push(...day.filter((_, i) => v[i].decision === "QUALIFIED"));
      }
      return out;
    },
  },
  H5_COMBINED_H2_H4: {
    rationale: "H2 then H4.",
    keep: (rows) => HYPOTHESES.H4_DIVERSIFIED.keep(HYPOTHESES.H2_MODEL_MARKET_AGREEMENT.keep(rows)),
  },
};

/** Fixed before any result was seen. Applied to dev-validate, with dev-train as a sign check. */
export const PROMOTION = {
  MIN_N: 30,
  MIN_RETAINED_SHARE: 0.5,
  MIN_ROI_GAIN_PP: 1.0,
  /** Final holdout: the same gains, n >= 50, and the removed picks must underperform the kept ones. */
  HOLDOUT_MIN_N: 50,
} as const;

const roiOf = (w: PolicyWindow) => w.roiPct;
const gain = (h: PolicyWindow, b: PolicyWindow) => (roiOf(h) != null && roiOf(b) != null ? roiOf(h)! - roiOf(b)! : null);

export type HypothesisResult = {
  name: HypothesisName;
  rationale: string;
  devTrain: { baseline: PolicyWindow; hypothesis: PolicyWindow };
  devValidate: { baseline: PolicyWindow; hypothesis: PolicyWindow };
  promoted: boolean;
  promotionReasons: string[];
};

export function evaluateOnDevelopment(baselineDevTrain: readonly ValidationRow[], baselineDevValidate: readonly ValidationRow[]): HypothesisResult[] {
  return (Object.keys(HYPOTHESES) as HypothesisName[]).map((name) => {
    const h = HYPOTHESES[name];
    const bt = windowStats(baselineDevTrain), bv = windowStats(baselineDevValidate);
    const ht = windowStats(h.keep(baselineDevTrain)), hv = windowStats(h.keep(baselineDevValidate));
    const reasons: string[] = [];
    if (hv.n < PROMOTION.MIN_N) reasons.push(`dev-validate n ${hv.n} < ${PROMOTION.MIN_N}`);
    if (bv.n && hv.n / bv.n < PROMOTION.MIN_RETAINED_SHARE) reasons.push(`keeps ${(100 * hv.n / bv.n).toFixed(0)}% of picks < ${100 * PROMOTION.MIN_RETAINED_SHARE}%`);
    if (hv.winRate == null || bv.winRate == null || hv.winRate < bv.winRate) reasons.push("dev-validate win rate not >= baseline");
    const gv = gain(hv, bv), gt = gain(ht, bt);
    if (gv == null || gv < PROMOTION.MIN_ROI_GAIN_PP) reasons.push(`dev-validate closing-reference ROI gain ${gv == null ? "n/a" : gv.toFixed(1)}pp < ${PROMOTION.MIN_ROI_GAIN_PP}pp`);
    if (gt == null || gt <= 0) reasons.push(`dev-train sign check failed (${gt == null ? "n/a" : gt.toFixed(1)}pp)`);
    return { name, rationale: h.rationale, devTrain: { baseline: bt, hypothesis: ht }, devValidate: { baseline: bv, hypothesis: hv }, promoted: reasons.length === 0, promotionReasons: reasons.length ? reasons : ["all promotion criteria met on development data"] };
  });
}

export type HoldoutVerdict = { name: HypothesisName; baseline: PolicyWindow; hypothesis: PolicyWindow; removed: PolicyWindow; verdict: "CREDIBLE_IMPROVEMENT" | "NO_CREDIBLE_IMPROVEMENT"; reasons: string[] };

/** Called only for promoted hypotheses. One evaluation on the untouched holdout. */
export function scoreOnHoldout(name: HypothesisName, baselineHoldout: readonly ValidationRow[]): HoldoutVerdict {
  const kept = HYPOTHESES[name].keep(baselineHoldout);
  const keptIds = new Set(kept.map((r) => r.id));
  const b = windowStats(baselineHoldout), h = windowStats(kept), removed = windowStats(baselineHoldout.filter((r) => !keptIds.has(r.id)));
  const reasons: string[] = [];
  if (h.n < PROMOTION.HOLDOUT_MIN_N) reasons.push(`holdout n ${h.n} < ${PROMOTION.HOLDOUT_MIN_N}`);
  if (h.winRate == null || b.winRate == null || h.winRate < b.winRate) reasons.push("holdout win rate not >= baseline");
  const g = gain(h, b);
  if (g == null || g < PROMOTION.MIN_ROI_GAIN_PP) reasons.push(`holdout closing-reference ROI gain ${g == null ? "n/a" : g.toFixed(1)}pp < ${PROMOTION.MIN_ROI_GAIN_PP}pp`);
  if (removed.n && removed.winRate != null && h.winRate != null && removed.winRate >= h.winRate) reasons.push("removed picks did not underperform the kept ones");
  return { name, baseline: b, hypothesis: h, removed, verdict: reasons.length ? "NO_CREDIBLE_IMPROVEMENT" : "CREDIBLE_IMPROVEMENT", reasons: reasons.length ? reasons : ["all holdout criteria met"] };
}
