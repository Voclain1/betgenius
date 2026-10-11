/**
 * Contextual internal links (SEO-503): from a pick's market to the three
 * places that explain and evidence it. For each market, the matching
 * predictions hub (where one exists), the guide that explains how the market
 * settles, and its line in the public track record.
 *
 * Pure, so every mapping is checked (scripts/check-seo.ts), and every target
 * is a page that exists today; a market without a hub simply gets none.
 */

export type LinkTarget = { href: string; label: string };
export type MarketPathway = { key: string; name: string; hub: LinkTarget | null; guide: LinkTarget; record: LinkTarget | null };

const PATHWAYS: Record<string, Omit<MarketPathway, "key">> = {
  OVER_2_5: {
    name: "Over 2.5 goals",
    hub: { href: "/predictions/over-2-5-goals", label: "Over 2.5 predictions" },
    guide: { href: "/guides/over-under-goals-explained", label: "How goals markets settle" },
    record: { href: "/track-record#market-over-25", label: "Over 2.5 record" },
  },
  GOALS: {
    name: "Total goals",
    hub: { href: "/predictions/goals", label: "Goals predictions" },
    guide: { href: "/guides/over-under-goals-explained", label: "How goals markets settle" },
    record: { href: "/track-record#market-over-under", label: "Total goals record" },
  },
  BTTS: {
    name: "Both teams to score",
    hub: { href: "/predictions/btts", label: "BTTS predictions" },
    guide: { href: "/guides/both-teams-to-score-explained", label: "How BTTS settles" },
    record: { href: "/track-record#market-btts", label: "BTTS record" },
  },
  DOUBLE_CHANCE: {
    name: "Double chance",
    hub: { href: "/predictions/double-chance", label: "Double chance predictions" },
    guide: { href: "/guides/double-chance-explained", label: "How double chance works" },
    record: { href: "/track-record#market-double-chance", label: "Double chance record" },
  },
  MATCH_WINNER: {
    name: "Match result",
    hub: null,
    guide: { href: "/guides/football-odds-and-implied-probability", label: "Reading odds and probability" },
    record: { href: "/track-record#market-match-winner", label: "Match result record" },
  },
  BANKER: {
    name: "Banker",
    hub: { href: "/predictions/banker", label: "Banker predictions" },
    guide: { href: "/guides/what-is-a-banker-bet", label: "What a banker bet is" },
    record: { href: "/track-record#category-banker", label: "Banker record" },
  },
  COMBO: {
    name: "Combo bet",
    hub: { href: "/multi-bets", label: "Multi bets" },
    guide: { href: "/guides/how-accumulators-work", label: "How multi bets work" },
    record: null,
  },
};

/** The pathway a pick belongs to, by its market (and Banker tag). Null for markets with no explainer yet. */
export function pathwayKey(row: { marketType: string; selection?: unknown; categories?: ReadonlyArray<{ category: string }> }): string | null {
  if (row.categories?.some((c) => c.category === "BANKER")) return "BANKER";
  switch (row.marketType) {
    case "OVER_UNDER": {
      const s = row.selection as { line?: unknown; direction?: unknown } | null;
      return s?.line === 2.5 && s?.direction === "OVER" ? "OVER_2_5" : "GOALS";
    }
    case "BTTS":
    case "DOUBLE_CHANCE":
    case "MATCH_WINNER":
      return row.marketType;
    case "SAME_GAME_DOUBLE":
      return "COMBO";
    default:
      return null;
  }
}

/**
 * Pathways for a page's picks, in the order the picks first raise them,
 * one per market, at most `max`. Callers pass only picks an anonymous
 * reader can see, so a link never reveals the market of a locked pick.
 */
export function marketPathways(
  rows: ReadonlyArray<{ marketType: string; selection?: unknown; categories?: ReadonlyArray<{ category: string }> }>,
  max = 3,
): MarketPathway[] {
  const out: MarketPathway[] = [];
  for (const row of rows) {
    const key = pathwayKey(row);
    if (!key || out.some((p) => p.key === key)) continue;
    out.push({ key, ...PATHWAYS[key] });
    if (out.length >= max) break;
  }
  return out;
}

/** Every link target, for the check that each resolves to a real page. */
export const ALL_PATHWAY_TARGETS: LinkTarget[] = Object.values(PATHWAYS).flatMap((p) => [p.hub, p.guide, p.record].filter((t): t is LinkTarget => t !== null));
