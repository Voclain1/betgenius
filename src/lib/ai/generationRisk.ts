import { LEAGUE_PRIORITY_ORDER, leaguePriorityRank } from "@/lib/leagues";
import type { GenerationTier } from "@/lib/ai/analysis";

/**
 * First 12 competition IDs in editorial priority order:
 * England (Premier League + Championship), Spain, Italy, Germany, France,
 * Portugal, UCL/UEL/Conference League, Netherlands and Belgium.
 */
export const VIP_PROXY_LEAGUE_CUTOFF = 12;
export const VIP_PROXY_LEAGUE_IDS = LEAGUE_PRIORITY_ORDER.slice(0, VIP_PROXY_LEAGUE_CUTOFF);

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
  if (categories.some((category) => category.toUpperCase() === "BANKER")) {
    return {
      calibration: "legacy",
      promptTiers: ["BANKER"],
      reason: "BANKER category intent preserves the original uncalibrated market style",
    };
  }

  if (leaguePriorityRank(leagueApiId) < VIP_PROXY_LEAGUE_CUTOFF) {
    return {
      calibration: "vip",
      promptTiers: ["VIP"],
      reason: "fixture is inside the top-12 league-priority proxy",
    };
  }

  return {
    calibration: "genius",
    promptTiers: ["GENIUS"],
    reason: "fixture is outside the top-12 league-priority proxy",
  };
}
