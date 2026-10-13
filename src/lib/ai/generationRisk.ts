import { LEAGUE_PRIORITY_ORDER, leaguePriorityRank } from "@/lib/leagues";
import type { GenerationTier } from "@/lib/ai/analysis";

/**
 * First 12 competition IDs in editorial priority order: England (Premier
 * League, Championship, FA Cup, EFL Cup) and the top flight and main cup of
 * Spain, Italy, Germany and France. The European club competitions sit just
 * after them, so they are NOT in this slice; see VIP_ROUTE_LEAGUE_IDS.
 */
export const VIP_PROXY_LEAGUE_CUTOFF = 12;
export const VIP_PROXY_LEAGUE_IDS = LEAGUE_PRIORITY_ORDER.slice(0, VIP_PROXY_LEAGUE_CUTOFF);

/**
 * Champions League, Europa League, Conference League.
 *
 * Generated under the VIP route alongside the proxy twelve. They used to fall
 * one place outside the slice, so every ordinary European pick took the GENIUS
 * route and VIP/PREMIUM curation (which requires the VIP route) could never
 * select one, however confident. The dedicated paid pass already treats them
 * as core (PAID_CORE_LEAGUE_IDS in src/lib/vipPremiumOverlay.ts).
 */
export const EUROPEAN_CLUB_COMPETITION_IDS: readonly number[] = [2, 3, 848];

/** Competitions whose ordinary picks are generated under the VIP calibration route. */
export const VIP_ROUTE_LEAGUE_IDS: readonly number[] = [...VIP_PROXY_LEAGUE_IDS, ...EUROPEAN_CLUB_COMPETITION_IDS];

export type GenerationRiskRoute = {
  calibration: "legacy" | "genius" | "vip";
  promptTiers: GenerationTier[];
  reason: string;
};

/**
 * Generation-time category intent is the `categories` array supplied by the
 * admin single/bulk forms or scheduled worker. BANKER intent always wins and
 * bypasses hedging. Every other request uses league rank as the proxy.
 */
export function resolveGenerationRisk(
  categories: readonly string[],
  leagueApiId?: number | null,
): GenerationRiskRoute {
  // BET_OF_THE_DAY rides the SAME branch as BANKER rather than getting a tier
  // of its own. The slot wants the bolder, uncalibrated market style — a pick
  // priced 2.20-4.50 is by definition not what the hedged calibration produces
  // — and the BANKER path already is that posture, tested and in use. Adding a
  // parallel prompt tier would mean two things to keep in step with no
  // behavioural difference between them.
  if (categories.some((category) => ["BANKER", "BET_OF_THE_DAY"].includes(category.toUpperCase()))) {
    return {
      calibration: "legacy",
      promptTiers: ["BANKER"],
      reason: "BANKER/BET_OF_THE_DAY category intent preserves the original uncalibrated market style",
    };
  }

  if (leagueApiId != null && VIP_ROUTE_LEAGUE_IDS.includes(leagueApiId)) {
    return {
      calibration: "vip",
      promptTiers: ["VIP"],
      reason: leaguePriorityRank(leagueApiId) < VIP_PROXY_LEAGUE_CUTOFF
        ? "fixture is inside the top-12 league-priority proxy"
        : "fixture is in a European club competition",
    };
  }

  return {
    calibration: "genius",
    promptTiers: ["GENIUS"],
    reason: "fixture is outside the VIP-route competitions",
  };
}
