/**
 * Evidence- and price-aware market selection (prediction quality remediation,
 * Nov 2026). Pure: no database, no provider calls.
 *
 * WHY. Production (30 days to 23 Nov 2026, read-only audit) showed:
 *  - Double Chance was 48% of ordinary generation and 57% of published
 *    FEATURED picks; Match Winner 4.5%.
 *  - Stated confidence is not comparable across markets: against the
 *    de-vigged bookmaker probability, the model states Double Chance about
 *    3 points LOW and BTTS about 5 points HIGH. Rankings that sort by stated
 *    confidence therefore favour whichever market the model under- or
 *    over-states, not the strongest selection.
 *  - The market forecasts settled outcomes better than stated confidence for
 *    Double Chance, Over/Under and BTTS (Brier 0.178 vs 0.188, 0.209 vs 0.225,
 *    0.248 vs 0.259) and about as well for Match Winner (0.168 vs 0.167).
 *  - Realised returns at the median price: 1.12-1.20 band -6.6% (90% interval
 *    -12.2 to -3.0, n=310), 1.20-1.30 band -1.0% (-5.5 to +3.7, n=341).
 *
 * WHAT. One fixture's candidate selections (the model's primary pick plus any
 * independently reasoned alternatives from the SAME model call) are each given:
 * the exact quoted price, bookmaker count, de-vigged market probability, a
 * blended probability (the model's view shrunk toward the market by a weight
 * fitted chronologically, see scripts/backtest-market-selection.ts), an expected
 * value at the quoted median, a quality tier and named reasons. One primary is
 * then chosen: never simply the highest confidence, never simply the highest
 * odds. The model's own primary is kept unless an alternative is materially
 * better. With no credible priced selection the decision is HOLD: the fixture
 * goes to admin review instead of a weak substitute being published.
 */
import { AUTO_MIN_MEDIAN_ODDS } from "@/lib/autoOddsFloor";
import { devigProbability } from "@/lib/marketConfirmed";
import { findSelection, toBookmakerSelection, type FixtureOdds } from "@/lib/odds";

export type MarketSelectionMode = "off" | "shadow" | "on";
/** off: nothing recorded. shadow: recorded for measurement, publication unchanged. on: the chosen primary is the persisted pick. */
export function marketSelectionMode(value: string | undefined = process.env.MARKET_SELECTION_MODE): MarketSelectionMode {
  return value === "on" || value === "shadow" ? value : "off";
}

export type SelectionPolicy = {
  MODEL_WEIGHT: number; HARD_MIN_ODDS: number; USEFUL_MIN_ODDS: number; MIN_BOOKS: number; MIN_BLENDED_PROBABILITY: number;
  MAX_MODEL_OVER_MARKET_PP: number; KEEP_PRIMARY_EV_TOLERANCE: number; OBJECTIVE: "repair" | "ev";
};
export const SELECTION_POLICY: SelectionPolicy = {
  /**
   * Weight on the model's stated confidence in the blended probability; the
   * rest is the de-vigged market. Fitted chronologically on settled priced
   * published singles (train on the earlier 60%, judged on the later 40%):
   * see docs/PREDICTION_MARKET_QUALITY_2026-11-23.md. The market is the
   * better forecaster for most markets, so the weight is well below 0.5.
   */
  MODEL_WEIGHT: 0.3,
  /** Existing hard floor for automatic selections (src/lib/autoOddsFloor.ts). Unchanged. */
  HARD_MIN_ODDS: AUTO_MIN_MEDIAN_ODDS,
  /**
   * Below this median a priced selection is "short": eligible only when no
   * qualified selection at or above it exists. Measured, not assumed: the
   * 1.12-1.20 band was the only short band with a credibly negative return.
   */
  USEFUL_MIN_ODDS: 1.2,
  /** Bookmakers quoting the exact selection before its price counts as verified. */
  MIN_BOOKS: 3,
  /** A published tip should be more likely than not, on the blended view. */
  MIN_BLENDED_PROBABILITY: 50,
  /** A model view this far above the market (pp) is not trusted for automatic choice. */
  MAX_MODEL_OVER_MARKET_PP: 15,
  /** Keep the model's own primary unless an alternative's EV is better by more than this ("ev" objective only). */
  KEEP_PRIMARY_EV_TOLERANCE: 0.02,
  /**
   * "repair" (default): keep the model's primary whenever it is QUALIFIED;
   * switch only to replace an unpriced, short, failing or ineligible primary
   * with the model's most likely QUALIFIED alternative. "ev": maximise blended
   * EV across candidates. Chronological backtest on 880 real multi-market
   * fixtures: "ev" cut Double Chance from 69% to 38% but lowered the strike
   * rate (74.5% to 65.2%) without improving the return (paired -0.8%, 90%
   * interval -2.9 to +2.1), so it is NOT the default.
   */
  OBJECTIVE: "repair" as "repair" | "ev",
};

export type CandidateInput = {
  marketType: string;
  selection: unknown;
  /** The model's stated confidence for THIS selection, 0-100. Never altered here. */
  confidence: number;
  source: "primary" | "alternative";
};

export type Tier = "QUALIFIED" | "SHORT" | "UNPRICED" | "INELIGIBLE";
export type EvaluatedCandidate = CandidateInput & {
  market: string | null;
  value: string | null;
  median: number | null;
  books: number | null;
  /** De-vigged market probability, 0-100 (Double Chance and Draw No Bet derived from 1X2). */
  fair: number | null;
  /** Draw No Bet only: fair price derived from 1X2; never an executable quote. */
  derivedFairOdds: number | null;
  blended: number | null;
  ev: number | null;
  tier: Tier;
  reasons: string[];
};

/** Draw No Bet probability from de-vigged 1X2: P(side) / (P(home) + P(away)). Null without a full 1X2 set. */
function drawNoBetFair(odds: FixtureOdds | null, selection: unknown): number | null {
  if (!odds) return null;
  const side = (selection as { value?: string } | null)?.value;
  const h = devigProbability(odds, "Match Winner", "Home")?.probability;
  const a = devigProbability(odds, "Match Winner", "Away")?.probability;
  if (h == null || a == null || !(h + a > 0)) return null;
  return side === "HOME" ? (100 * h) / (h + a) : side === "AWAY" ? (100 * a) / (h + a) : null;
}

export function evaluateCandidate(c: CandidateInput, odds: FixtureOdds | null, policy: SelectionPolicy = SELECTION_POLICY): EvaluatedCandidate {
  const mapped = toBookmakerSelection(c.marketType, c.selection);
  const sel = mapped && odds ? findSelection(odds, mapped.market, mapped.value) : null;
  const fairQuote = mapped && odds ? devigProbability(odds, mapped.market, mapped.value)?.probability ?? null : null;
  const dnb = c.marketType === "DRAW_NO_BET" ? drawNoBetFair(odds, c.selection) : null;
  const fair = fairQuote ?? dnb;
  const median = sel?.median ?? null;
  const books = sel?.bookmakers ?? null;
  const blended = fair != null ? policy.MODEL_WEIGHT * c.confidence + (1 - policy.MODEL_WEIGHT) * fair : null;
  const ev = blended != null && median != null ? (blended / 100) * median - 1 : null;
  const reasons: string[] = [];
  let tier: Tier;
  if (median == null) {
    tier = "UNPRICED";
    reasons.push(c.marketType === "DRAW_NO_BET" ? "no executable Draw No Bet quote (fair price derived from 1X2 only)"
      : mapped ? "selection not quoted in the cached odds" : `no cached bookmaker market for ${c.marketType}`);
    if (dnb != null && dnb > 100 / policy.USEFUL_MIN_ODDS) reasons.push(`derived fair price ${(100 / dnb).toFixed(2)} is below ${policy.USEFUL_MIN_ODDS.toFixed(2)}`);
  } else if (median < policy.HARD_MIN_ODDS) {
    tier = "INELIGIBLE"; reasons.push(`median ${median.toFixed(2)} below the ${policy.HARD_MIN_ODDS.toFixed(2)} floor`);
  } else if ((books ?? 0) < policy.MIN_BOOKS) {
    tier = "UNPRICED"; reasons.push(`only ${books ?? 0} bookmakers quote it`);
  } else if (blended != null && blended < policy.MIN_BLENDED_PROBABILITY) {
    tier = "INELIGIBLE"; reasons.push(`blended probability ${blended.toFixed(1)}% is below ${policy.MIN_BLENDED_PROBABILITY}%`);
  } else if (fair != null && c.confidence - fair > policy.MAX_MODEL_OVER_MARKET_PP) {
    tier = "INELIGIBLE"; reasons.push(`stated ${c.confidence}% is ${(c.confidence - fair).toFixed(1)}pp above the market's ${fair.toFixed(1)}%`);
  } else if (median < policy.USEFUL_MIN_ODDS) {
    tier = "SHORT"; reasons.push(`short price ${median.toFixed(2)}`);
  } else {
    tier = "QUALIFIED";
  }
  return { ...c, market: mapped?.market ?? null, value: mapped?.value ?? null, median, books, fair, blended, ev,
    derivedFairOdds: dnb != null && dnb > 0 ? 100 / dnb : null, tier, reasons };
}

export type SelectionDecision = "KEEP_PRIMARY" | "SWITCH" | "HOLD";
export type HoldReason = "INSUFFICIENT_EVIDENCE" | "NO_VERIFIED_PRICE" | "NO_CREDIBLE_SELECTION" | "NO_CANDIDATES";
export type SelectionResult = {
  decision: SelectionDecision;
  holdReason: HoldReason | null;
  /** The selection to persist as the fixture's primary (the model's own primary on HOLD, for admin review). */
  chosen: EvaluatedCandidate | null;
  candidates: EvaluatedCandidate[];
  policyVersion: string;
};
export const SELECTION_POLICY_VERSION = "msel-2026-11-23";

const key = (c: { marketType: string; selection: unknown }) => c.marketType + JSON.stringify(c.selection ?? null);

/**
 * Choose one primary for a fixture.
 *
 * 1. No credible football evidence: HOLD for review (the model's primary is kept, never published automatically).
 * 2. Pool = QUALIFIED candidates; else SHORT ones; else HOLD (nothing priced and credible).
 * 3. Best = highest EV on the blended probability; ties to the higher blended probability.
 * 4. The model's primary stays unless the best is better by more than the tolerance.
 */
export function selectPrimary(
  inputs: readonly CandidateInput[],
  odds: FixtureOdds | null,
  opts: { evidenceComplete: boolean; policy?: SelectionPolicy } = { evidenceComplete: true },
): SelectionResult {
  const policy = opts.policy ?? SELECTION_POLICY;
  const seen = new Set<string>();
  const candidates = inputs.filter((c) => { const k = key(c); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((c) => evaluateCandidate(c, odds, policy));
  const primary = candidates.find((c) => c.source === "primary") ?? candidates[0] ?? null;
  const result = (decision: SelectionDecision, holdReason: HoldReason | null, chosen: EvaluatedCandidate | null): SelectionResult =>
    ({ decision, holdReason, chosen, candidates, policyVersion: SELECTION_POLICY_VERSION });
  if (!primary) return result("HOLD", "NO_CANDIDATES", null);
  if (!opts.evidenceComplete) return result("HOLD", "INSUFFICIENT_EVIDENCE", primary);
  const qualified = candidates.filter((c) => c.tier === "QUALIFIED");
  const pool = qualified.length ? qualified : candidates.filter((c) => c.tier === "SHORT");
  if (!pool.length) {
    const anyUnpriced = candidates.some((c) => c.tier === "UNPRICED");
    return result("HOLD", anyUnpriced ? "NO_VERIFIED_PRICE" : "NO_CREDIBLE_SELECTION", primary);
  }
  if (policy.OBJECTIVE === "repair") {
    if (pool.includes(primary)) return result("KEEP_PRIMARY", null, primary);
    const likeliest = [...pool].sort((a, b) => (b.blended! - a.blended!) || (b.ev! - a.ev!))[0];
    return result("SWITCH", null, likeliest);
  }
  const best = [...pool].sort((a, b) => (b.ev! - a.ev!) || (b.blended! - a.blended!))[0];
  if (pool.includes(primary) && primary.ev! >= best.ev! - policy.KEEP_PRIMARY_EV_TOLERANCE) return result("KEEP_PRIMARY", null, primary);
  return result("SWITCH", null, best);
}

/** Compact, JSON-safe record stored with the generation job (AIJob.rawOutput.marketSelection). */
export function selectionRecord(r: SelectionResult, mode: MarketSelectionMode, quoteFetchedAt: Date | string | null) {
  const slim = (c: EvaluatedCandidate) => ({ marketType: c.marketType, selection: c.selection, confidence: c.confidence, source: c.source,
    median: c.median, books: c.books, fair: c.fair == null ? null : Math.round(c.fair * 10) / 10, blended: c.blended == null ? null : Math.round(c.blended * 10) / 10,
    ev: c.ev == null ? null : Math.round(c.ev * 1000) / 1000, tier: c.tier, reasons: c.reasons });
  return { mode, policyVersion: r.policyVersion, decision: r.decision, holdReason: r.holdReason, chosen: r.chosen ? slim(r.chosen) : null,
    candidates: r.candidates.map(slim), quoteFetchedAt: quoteFetchedAt ? new Date(quoteFetchedAt).toISOString() : null };
}
export type SelectionRecord = ReturnType<typeof selectionRecord>;

/**
 * Display-quality tier for ranking already-published rows (homepage / Genius),
 * from the record fixed at generation. Lower is better. Rows without a record
 * (legacy) return null and keep the existing ordering.
 */
export function displayTier(rec: { chosen?: { tier?: string } | null; decision?: string } | null | undefined): number | null {
  const t = rec?.chosen?.tier;
  if (!t) return null;
  return t === "QUALIFIED" ? 0 : t === "SHORT" ? 1 : t === "UNPRICED" ? 2 : 3;
}
