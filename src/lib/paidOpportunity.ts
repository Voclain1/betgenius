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
  return { fixtures: 0, everInScope: 0, neverInScope: 0, neverInScopeLopsided: 0, noRunInWindow: 0, attempted: 0 };
}
