/**
 * VIP/Premium Sprint 10: alternative-market discovery, PRE-REGISTERED.
 *
 * Question: are there VIP/PREMIUM opportunities, in professional fixtures the
 * dedicated pass already covers, that its favourite-based targeting
 * (lopsidednessSignal: Match Winner / Double Chance side >= 75%) never
 * examines, and that independently clear the EXISTING paid gate?
 *
 * Path B under test: target a covered fixture because a GOALS selection is
 * priced inside the paid band, then run exactly the dedicated pass's
 * generation (same prompt, intent, provider and model) and judge every draft
 * with exactly the dedicated gate. Nothing about the bar changes.
 *
 * Everything here is fixed before the first model call and must not be tuned
 * on results. Pure; the runner (scripts/run-alt-market-experiment.ts) supplies
 * the rows. RESEARCH ONLY: no production code path imports this file (a check
 * pins that), and nothing here can publish.
 */
import { createHash } from "node:crypto";
import type { FixtureOdds } from "@/lib/odds";
import { devigProbability, MC_MAX_QUOTE_AGE_MS, MC_MIN_BOOKMAKERS, MC_MIN_MARKET_PROBABILITY } from "@/lib/marketConfirmed";

export const SPEC_VERSION = "alt-market-s10-v1";

/** Hard ceilings for the whole experiment, across every invocation. Not targets. */
export const CAPS = {
  /** Fixtures evaluated (one generation each). */
  MAX_EVALUATIONS: 30,
  /** Model HTTP requests. One evaluation is exactly one request (no SDK retry, no fallback provider). */
  MAX_MODEL_REQUESTS: 30,
  /** api-football requests. The runner is cache-only, so the expected spend is 0. */
  MAX_API_FOOTBALL_REQUESTS: 40,
  /** USD, at the published price of the configured model (claude-haiku-5-5: $0.10 / $0.50 per MTok in / out, prompts <= 100K tokens). */
  MAX_COST_USD: 0.3,
  /** Worst case of one request: max_tokens 16,000 output + an assumed 20,000-token prompt. Used to refuse a call that could breach MAX_COST_USD. */
  WORST_CASE_COST_PER_REQUEST_USD: 16_000 * 0.5e-6 + 20_000 * 0.1e-6,
  /** Consecutive provider errors that stop the run. */
  MAX_CONSECUTIVE_ERRORS: 3,
} as const;

export const MODEL_PRICE_PER_TOKEN = { "claude-haiku-5-5": { input: 0.1e-6, output: 0.5e-6 } } as const;

/** Eligibility: covered, upcoming, priced now, paid-scope, NOT examined by favourite targeting. */
export const ELIGIBILITY = {
  /** The dedicated pass's own window, narrowed to where a fresh quote can exist (the pass warms odds only inside 24h). */
  MIN_HOURS_TO_KICKOFF: 12,
  MAX_HOURS_TO_KICKOFF: 24,
  /** The gate's freshness bar: a quote older than this is not read. */
  MAX_QUOTE_AGE_MS: MC_MAX_QUOTE_AGE_MS,
  MIN_BOOKMAKERS: MC_MIN_BOOKMAKERS,
} as const;

/** Paid band, the gate's own: market >= 75% and fair odds >= 1.15 (<= 86.96%). */
export const BAND = { MIN: MC_MIN_MARKET_PROBABILITY, MAX: 100 / 1.15 } as const;

/**
 * Selections whose in-band price makes a fixture an experimental target.
 * Over 1.5 and Over 2.5 only (the brief: goals first). Under 2.5, BTTS and
 * double chance are RECORDED for comparison, never used to select fixtures.
 */
export const TARGET_SELECTIONS = [
  { market: "Goals Over/Under", value: "Over 1.5" },
  { market: "Goals Over/Under", value: "Over 2.5" },
] as const;
export const COMPARISON_SELECTIONS = [
  { market: "Goals Over/Under", value: "Under 2.5" },
  { market: "Goals Over/Under", value: "Under 3.5" },
  { market: "Both Teams Score", value: "Yes" },
  { market: "Both Teams Score", value: "No" },
] as const;

export type PricedSelection = { market: string; value: string; probability: number; bookmakers: number };

/** Every target/comparison selection the quote prices, with books. Pure. */
export function pricedSelections(odds: FixtureOdds | null, list: ReadonlyArray<{ market: string; value: string }>): PricedSelection[] {
  if (!odds?.markets) return [];
  const out: PricedSelection[] = [];
  for (const s of list) {
    const d = devigProbability(odds, s.market as any, s.value);
    if (d) out.push({ market: s.market, value: s.value, probability: d.probability, bookmakers: d.bookmakers });
  }
  return out;
}

/**
 * Favourite targeting's signal with the away double chance also read under the
 * feed's own label. lopsidednessSignal asks for "Away/Draw", but api-football
 * labels it "Draw/Away" (toBookmakerSelection, shortPriceGuard and the recorded
 * Inter v Shakhtar quote all use "Draw/Away"), and devigProbability takes book
 * coverage from the real Double Chance line by exact label. Research copy: the
 * production fix, if the baseline confirms the defect, belongs in
 * marketConfirmed.ts. Pure.
 */
export function correctedFavouriteSignal(odds: FixtureOdds | null): PricedSelection | null {
  const wants = [
    { market: "Match Winner", value: "Home" }, { market: "Match Winner", value: "Away" },
    { market: "Double Chance", value: "Home/Draw" }, { market: "Double Chance", value: "Away/Draw" }, { market: "Double Chance", value: "Draw/Away" },
  ];
  const ok = pricedSelections(odds, wants).filter((s) => s.bookmakers >= ELIGIBILITY.MIN_BOOKMAKERS);
  return ok.sort((a, b) => b.probability - a.probability)[0] ?? null;
}

/** The goals-band signal: the strongest TARGET selection inside the band at enough books, or null. */
export function goalsBandSignal(odds: FixtureOdds | null): PricedSelection | null {
  const inBand = pricedSelections(odds, TARGET_SELECTIONS).filter((s) => s.bookmakers >= ELIGIBILITY.MIN_BOOKMAKERS && s.probability >= BAND.MIN && s.probability <= BAND.MAX);
  return inBand.sort((a, b) => b.probability - a.probability || a.value.localeCompare(b.value))[0] ?? null;
}

export type CandidateFixture = {
  fixtureApiId: number;
  matchKey: string;
  leagueApiId: number;
  kickoff: Date;
  /** "CORE" = PAID_CORE_LEAGUE_IDS, "SECONDARY" = PAID_WIDENED_LEAGUE_IDS. */
  group: "CORE" | "SECONDARY";
  /** Lagos kickoff day already carries <= DRY_DAY_MAX_PAID published VIP/PREMIUM fixtures (known now, pre-kickoff). */
  dryDay: boolean;
};

export type EligibilityFacts = {
  ledgerSucceeded: boolean;
  hasOrdinaryRowWithContext: boolean;
  /** Any VIP_PREMIUM-intent attempt already made on the fixture. */
  alreadyAttempted: boolean;
  /** A live dedicated paid pick already on the fixture. */
  hasDedicatedPaid: boolean;
  /** Paid scope group, null when outside PAID_ANY. */
  group: "CORE" | "SECONDARY" | null;
  hoursToKickoff: number;
  quoteAgeMs: number | null;
  /** Favourite targeting's own signal on the same quote (lopsidednessSignal probability), null if none. */
  favouriteSignal: number | null;
  goals: PricedSelection | null;
};

export type Ineligible =
  | "NOT_COVERED" | "NO_CONTEXT" | "ALREADY_ATTEMPTED" | "HAS_DEDICATED_PAID" | "OUT_OF_PAID_SCOPE"
  | "OUTSIDE_WINDOW" | "NO_FRESH_QUOTE" | "FAVOURITE_TARGETED" | "NO_GOALS_IN_BAND";

/**
 * Eligible = a fixture favourite targeting would NOT examine (its signal < 75
 * or absent) and whose fresh quote prices Over 1.5 / Over 2.5 inside the band.
 * First failing rule, in this order. Pure.
 */
export function eligibility(f: EligibilityFacts): { eligible: true } | { eligible: false; reason: Ineligible } {
  if (!f.ledgerSucceeded) return { eligible: false, reason: "NOT_COVERED" };
  if (!f.hasOrdinaryRowWithContext) return { eligible: false, reason: "NO_CONTEXT" };
  if (f.group == null) return { eligible: false, reason: "OUT_OF_PAID_SCOPE" };
  if (f.alreadyAttempted) return { eligible: false, reason: "ALREADY_ATTEMPTED" };
  if (f.hasDedicatedPaid) return { eligible: false, reason: "HAS_DEDICATED_PAID" };
  if (f.hoursToKickoff < ELIGIBILITY.MIN_HOURS_TO_KICKOFF || f.hoursToKickoff > ELIGIBILITY.MAX_HOURS_TO_KICKOFF) return { eligible: false, reason: "OUTSIDE_WINDOW" };
  if (f.quoteAgeMs == null || f.quoteAgeMs > ELIGIBILITY.MAX_QUOTE_AGE_MS) return { eligible: false, reason: "NO_FRESH_QUOTE" };
  if ((f.favouriteSignal ?? 0) >= MC_MIN_MARKET_PROBABILITY) return { eligible: false, reason: "FAVOURITE_TARGETED" };
  if (!f.goals) return { eligible: false, reason: "NO_GOALS_IN_BAND" };
  return { eligible: true };
}

/** Sampling allocation per invocation and overall: core first, secondary capped. */
export const ALLOCATION = { CORE_MAX: 20, SECONDARY_MAX: 10, DRY_DAY_MAX_PAID: 2 } as const;

/** Deterministic, result-blind order: dry days first, then a salted hash of the provider fixture id. */
export function sampleKey(fixtureApiId: number): string {
  return createHash("sha256").update(`${SPEC_VERSION}:${fixtureApiId}`).digest("hex");
}

export function sampleCandidates(
  eligible: readonly CandidateFixture[],
  budget: { evaluationsLeft: number; coreUsed: number; secondaryUsed: number },
): CandidateFixture[] {
  const ordered = [...eligible].sort((a, b) => Number(b.dryDay) - Number(a.dryDay) || sampleKey(a.fixtureApiId).localeCompare(sampleKey(b.fixtureApiId)));
  const out: CandidateFixture[] = [];
  let core = budget.coreUsed, sec = budget.secondaryUsed;
  for (const c of ordered) {
    if (out.length >= budget.evaluationsLeft) break;
    if (c.group === "CORE" && core < ALLOCATION.CORE_MAX) { out.push(c); core++; }
    else if (c.group === "SECONDARY" && sec < ALLOCATION.SECONDARY_MAX) { out.push(c); sec++; }
  }
  return out;
}

// ── Cost and cap accounting ─────────────────────────────────────────────────

export type Ledger = { evaluations: number; modelRequests: number; apiFootballRequests: number; costUsd: number; coreUsed: number; secondaryUsed: number };

export function costOf(model: string, usage: { promptTokens: number | null; outputTokens: number | null }): number {
  const price = MODEL_PRICE_PER_TOKEN[model as keyof typeof MODEL_PRICE_PER_TOKEN];
  if (!price) return CAPS.WORST_CASE_COST_PER_REQUEST_USD; // unknown model: charge the worst case
  return (usage.promptTokens ?? 20_000) * price.input + (usage.outputTokens ?? 16_000) * price.output;
}

/** May one more model request be made? Refuses before the call, never after. */
export function mayCall(l: Ledger): { ok: true } | { ok: false; reason: string } {
  if (l.evaluations >= CAPS.MAX_EVALUATIONS) return { ok: false, reason: `evaluation cap ${CAPS.MAX_EVALUATIONS} reached` };
  if (l.modelRequests >= CAPS.MAX_MODEL_REQUESTS) return { ok: false, reason: `model request cap ${CAPS.MAX_MODEL_REQUESTS} reached` };
  if (l.apiFootballRequests > CAPS.MAX_API_FOOTBALL_REQUESTS) return { ok: false, reason: "api-football cap exceeded" };
  if (l.costUsd + CAPS.WORST_CASE_COST_PER_REQUEST_USD > CAPS.MAX_COST_USD) return { ok: false, reason: `cost ceiling $${CAPS.MAX_COST_USD} could be breached by one more request` };
  return { ok: true };
}

// ── Evaluation criteria (fixed before any result) ───────────────────────────

/**
 * Per evaluated fixture, the outcome is the BEST draft under the existing
 * dedicated rules (paidTierFor on the gate verdict, repeats refused, one pick
 * per fixture by compareMarketConfirmed):
 *   PREMIUM, VIP, or NONE (with the first gate rejection of the best draft).
 *
 * Reported after the run (qualification, no outcome needed):
 *   - qualification rate with a Wilson 95% interval, core and secondary apart;
 *   - incremental fixtures: qualifying fixtures with no existing VIP/PREMIUM pick;
 *   - dry-day fixtures that would have gained a paid pick;
 *   - qualifying markets and the model's confidence distribution.
 * Reported after settlement (outcome-dependent, PENDING until then):
 *   - strike rate (Wilson 95%), calibration (stated vs realised), ROI at the
 *     recorded pre-kickoff entry price of the selection, core vs secondary.
 *
 * Decision rule for FURTHER RESEARCH (not activation), fixed now:
 *   GO to a larger prospective shadow  if >= 5 incremental qualifying fixtures
 *                                       AND the qualification rate's Wilson
 *                                       lower bound >= 10%.
 *   NO-GO                               if <= 1 incremental qualifying fixture.
 *   INCONCLUSIVE                        otherwise.
 * Activation of Path B is out of scope whatever the result: 30 fixtures cannot
 * establish quality, and outcomes will be too few to read.
 */
export const DECISION = { GO_MIN_INCREMENTAL: 5, GO_MIN_WILSON_LOWER: 0.1, NOGO_MAX_INCREMENTAL: 1 } as const;

export function researchDecision(evaluated: number, incrementalQualifying: number, wilsonLower: number | null): "GO_LARGER_SHADOW" | "NO_GO" | "INCONCLUSIVE" {
  if (incrementalQualifying <= DECISION.NOGO_MAX_INCREMENTAL) return "NO_GO";
  if (incrementalQualifying >= DECISION.GO_MIN_INCREMENTAL && (wilsonLower ?? 0) >= DECISION.GO_MIN_WILSON_LOWER) return "GO_LARGER_SHADOW";
  void evaluated;
  return "INCONCLUSIVE";
}
