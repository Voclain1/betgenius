import { toBookmakerSelection, type FixtureOdds } from "@/lib/odds";
import { devigProbability, drawNoBetProbability } from "@/lib/marketConfirmed";

/**
 * A sanity check of a draft against the betting market.
 *
 * The model never sees prices; it reasons from the evidence digest alone, and
 * that is deliberate. But when it states 55% for an away side the bookmakers
 * make an 8% chance (Shakhtar at Inter, October 2026: two Champions League
 * games read as the whole story), the evidence was misread, not the market.
 * So a draft whose confidence sits more than MARKET_SANITY_MAX_GAP_PP above
 * the de-vigged market probability for the same selection is not saved.
 *
 * Only ABOVE: a pick the model rates below the market is cautious, not wrong.
 * And wide on purpose: 25 points leaves room for a model that genuinely sees
 * more than the market (team news, a rotated side), and catches only the
 * picks that read the match the wrong way round.
 *
 * Markets with no comparable price (correct score, win either half, team
 * totals...) and fixtures with no quote pass unchecked. Pure, so the rule is
 * checked without a database (scripts/check-market-sanity.ts).
 */
export const MARKET_SANITY_MAX_GAP_PP = 25;

/** De-vigged market probability (0-100) for a draft's own selection, or null when the market cannot say. */
export function marketProbabilityFor(odds: FixtureOdds | null, marketType: string, selection: unknown): number | null {
  if (!odds) return null;
  if (marketType === "DRAW_NO_BET") {
    const v = (selection as { value?: string } | null)?.value;
    if (v !== "HOME" && v !== "AWAY") return null;
    return drawNoBetProbability(odds, v === "HOME" ? "Home" : "Away")?.probability ?? null;
  }
  if (!["MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS"].includes(marketType)) return null;
  const mapped = toBookmakerSelection(marketType, selection);
  if (!mapped) return null;
  return devigProbability(odds, mapped.market, mapped.value)?.probability ?? null;
}

export type MarketDisagreement = { confidence: number; market: number; gapPP: number };

/** The draft's confidence and the market's view, when the draft is too far above it. Null otherwise. */
export function farAboveMarket(odds: FixtureOdds | null, draft: { marketType: string; selection: unknown; confidence: number }): MarketDisagreement | null {
  const market = marketProbabilityFor(odds, draft.marketType, draft.selection);
  if (market == null || typeof draft.confidence !== "number") return null;
  const gapPP = draft.confidence - market;
  return gapPP > MARKET_SANITY_MAX_GAP_PP ? { confidence: draft.confidence, market: Math.round(market), gapPP: Math.round(gapPP) } : null;
}

/** "Inter to win", "Shakhtar or Draw", "Over 2.5"... for the retry prompt. */
function describe(marketType: string, selection: unknown, home: string, away: string): string {
  const s = (selection ?? {}) as { value?: string; line?: number; direction?: string };
  const side = (v?: string) => (v === "HOME" ? home : v === "AWAY" ? away : "Draw");
  switch (marketType) {
    case "MATCH_WINNER":
      return s.value === "DRAW" ? "Draw" : `${side(s.value)} to win`;
    case "DRAW_NO_BET":
      return `${side(s.value)} (Draw No Bet)`;
    case "DOUBLE_CHANCE":
      return s.value === "HOME_OR_DRAW" ? `${home} or Draw` : s.value === "AWAY_OR_DRAW" ? `${away} or Draw` : `${home} or ${away}`;
    case "OVER_UNDER":
      return `${s.direction === "UNDER" ? "Under" : "Over"} ${s.line} goals`;
    case "BTTS":
      return `Both teams to score: ${s.value === "NO" ? "No" : "Yes"}`;
    default:
      return marketType;
  }
}

/**
 * The second ask, when every draft read the match against the market: the
 * market's own view of the result, and each rejected pick beside it.
 */
export function marketSanityRetryBlock(
  odds: FixtureOdds | null,
  rejected: readonly { marketType: string; selection: unknown; confidence: number }[],
  home: string,
  away: string,
): string {
  const result = (["Home", "Draw", "Away"] as const)
    .map((v) => {
      const p = odds ? devigProbability(odds, "Match Winner", v)?.probability : null;
      return p == null ? null : `${v === "Home" ? home : v === "Away" ? away : "Draw"} ${Math.round(p)}%`;
    })
    .filter(Boolean);
  const lines = rejected.map((d) => {
    const m = marketProbabilityFor(odds, d.marketType, d.selection);
    return `  - ${describe(d.marketType, d.selection, home, away)}: you said ${d.confidence}%, the market about ${m == null ? "?" : Math.round(m)}%`;
  });
  return `
MARKET CHECK — YOUR LAST ANSWER READ THIS MATCH AGAINST THE MARKET.

${result.length === 3 ? `The bookmakers' view of the result (margin removed): ${result.join(", ")}.\n` : ""}Your picks, beside the market's probability for the same selection:
${lines.join("\n")}

A gap that wide almost always means the evidence was misread: a two- or
three-game competition sample taken as the whole story, or one side's true
level (its domestic league standing, its season record) overlooked. Re-read the
evidence. Return the pick the full evidence supports, with a confidence no
more than ${MARKET_SANITY_MAX_GAP_PP} points above the market's view of that
selection unless the evidence names a concrete reason the market is wrong
(key absences, a rotated side), and say what that reason is.
`;
}

/** Thrown when every draft stayed far above the market, even after the second ask. */
export class MarketSanityError extends Error {
  constructor(match: string, worst: MarketDisagreement) {
    super(`Every pick for ${match} was far above the bookmakers' view (${worst.confidence}% against about ${worst.market}%)`);
    this.name = "MarketSanityError";
  }
}
