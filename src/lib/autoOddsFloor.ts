import { findSelection, toBookmakerSelection, type FixtureOdds } from "@/lib/odds";

/**
 * Publication-value floor for automatically generated, bookmaker-quoted picks.
 * This is NOT a profitability/expected-value claim: 1.12 is the owner's
 * minimum useful displayed price. Use median rather than a single outlier.
 *
 * TEAM_TOTAL is deliberately held until its exact full-match home/away
 * bookmaker lines are retained by trimOdds. The feed can quote them, but the
 * current cache does NOT retain them. A team-under-2.5 recommendation must not
 * evade this floor merely because no comparable price survived trimming.
 *
 * Other selections with no mapped/retained price remain on the existing
 * ordinary-generation path; they must not be presented as price-verified.
 * The VIP/PREMIUM and Bet of the Day gates remain independent and stricter.
 */
export const AUTO_MIN_MEDIAN_ODDS = 1.12;

export type AutoOddsFailure = {
  reason: "BELOW_MINIMUM_ODDS" | "TEAM_TOTAL_UNPRICED";
  marketType: string;
  selection: unknown;
  median: number | null;
};

export function automaticOddsFailure(
  odds: FixtureOdds | null,
  marketType: string,
  selection: unknown,
): AutoOddsFailure | null {
  // No exact team-total price exists in today's trimmed cache. Fail closed
  // rather than silently publishing a near-formality (e.g. team Under 2.5).
  if (marketType === "TEAM_TOTAL") {
    return { reason: "TEAM_TOTAL_UNPRICED", marketType, selection, median: null };
  }

  const mapped = toBookmakerSelection(marketType, selection);
  if (!odds || !mapped) return null;
  const price = findSelection(odds, mapped.market, mapped.value)?.median;
  if (price == null || !Number.isFinite(price)) return null;
  return price < AUTO_MIN_MEDIAN_ODDS
    ? { reason: "BELOW_MINIMUM_ODDS", marketType, selection, median: price }
    : null;
}

export function automaticOddsRetryBlock(failures: readonly AutoOddsFailure[]): string {
  if (failures.length === 0) return "";
  const lines = failures.map((f) => {
    if (f.reason === "TEAM_TOTAL_UNPRICED") {
      return "  - TEAM_TOTAL: the required exact bookmaker line is not available for verification";
    }
    const mapped = toBookmakerSelection(f.marketType, f.selection);
    return `  - ${mapped ? `${mapped.market}, ${mapped.value}` : f.marketType}: median ${f.median?.toFixed(2) ?? "unavailable"}`;
  });
  return `
AUTOMATIC ODDS FLOOR — RECONSIDER YOUR PICKS.

The following proposed selections cannot be published:
${lines.join("\n")}

Do NOT repeat them. Find the strongest OTHER selection supported by the supplied
evidence, not an invented or artificially risky pick. A quoted price must be at
least ${AUTO_MIN_MEDIAN_ODDS.toFixed(2)}. Do not return TEAM_TOTAL until exact
team-total bookmaker pricing is supported. Match winner, double chance, match
goals and both teams to score are alternatives only when the match evidence
actually supports them. If no justified selection exists, return fewer picks.
`;
}

export class AutoOddsFloorError extends Error {
  constructor(match: string) {
    super(`No automatically generated pick with an acceptable quoted price remained for ${match}`);
    this.name = "AutoOddsFloorError";
  }
}
