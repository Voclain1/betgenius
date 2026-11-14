/**
 * VIP/Premium Sprint 09: small pure helpers for the paid-opportunity audit
 * (scripts/measure-paid-opportunity.ts).
 */
import { PAID_CORE_LEAGUE_IDS, PAID_WIDENED_LEAGUE_IDS } from "@/lib/vipPremiumOverlay";

export type ScopeGroup = "PAID_CORE" | "PAID_WIDENED" | "OUTSIDE";

/** Which paid scope a competition belongs to: always eligible, thin-day only, or never. */
export function scopeGroup(leagueApiId: number | null | undefined): ScopeGroup {
  if (PAID_CORE_LEAGUE_IDS.includes(leagueApiId ?? -1)) return "PAID_CORE";
  if (PAID_WIDENED_LEAGUE_IDS.includes(leagueApiId ?? -1)) return "PAID_WIDENED";
  return "OUTSIDE";
}

/** Per kickoff day: how the dedicated pass's recorded scope treated that day's covered widened-scope fixtures. */
export function kickoffDayScope() {
  return { fixtures: 0, everInScope: 0, neverInScope: 0, neverInScopeLopsided: 0, neverInScopeLopsidedAdmissible: 0, noRunInWindow: 0, attempted: 0 };
}

/**
 * Attempts on a kickoff day that the day's own core fixtures could never use,
 * even if every core fixture not yet attempted were to qualify: the quota left
 * after reserving one slot per such fixture. Capped by what could fill them.
 */
export function spareQuotaSlots(input: { quota: number; attemptsUsed: number; coreUnattempted: number; widenedLopsidedOutOfScope: number }): number {
  const spare = input.quota - input.attemptsUsed - input.coreUnattempted;
  return Math.max(0, Math.min(spare, input.widenedLopsidedOutOfScope));
}

export type PaidLoss =
  | "VIP"
  | "OUTSIDE_PAID_SCOPE" // intentional: competition never paid-eligible
  | "WIDENED_SCOPE_HEALTHY_DAY" // intentional: widened competition, pass never widened while it was in the window
  | "MARKET_BELOW_BAR" // intentional: not lopsided at the closing quote, so never a target
  | "MODEL_BELOW_FLOOR" // intentional: attempted, every draft under 75
  | "GATE_REJECTED" // intentional: a draft at 75+ failed the market gate (gap, band, books, repeat)
  | "NOT_ATTEMPTED_IN_SCOPE"; // in scope and lopsided at close, never attempted: the only class that can hide an avoidable loss

/** First reason a covered fixture is not in VIP, in pipeline order. Pure. */
export function firstPaidLoss(x: {
  vip: boolean; group: ScopeGroup; everInScope: boolean | null; attempted: boolean; draftMaxConf: number | null; promoted: boolean; closingHeadline: number | null;
}): PaidLoss {
  if (x.vip) return "VIP";
  if (x.group === "OUTSIDE") return "OUTSIDE_PAID_SCOPE";
  if (x.attempted) return (x.draftMaxConf ?? 0) >= 75 ? "GATE_REJECTED" : "MODEL_BELOW_FLOOR";
  if (x.group === "PAID_WIDENED" && x.everInScope !== true) return "WIDENED_SCOPE_HEALTHY_DAY";
  if ((x.closingHeadline ?? 0) < 75) return "MARKET_BELOW_BAR";
  return "NOT_ATTEMPTED_IN_SCOPE";
}
