/**
 * The market pages: every published tip of the day in one market, from any
 * free category. VIP and Premium tips are left out (they belong to their
 * members' feeds), so these pages never show a locked row.
 *
 * One list, read by every place that links to them: the Tips menu, the chips
 * on the feed pages, the homepage line and the /predictions index. Client-safe
 * (no database), so the nav can import it.
 */

export type MarketHub = { key: MarketHubKey; href: string; label: string; desc: string };
export type MarketHubKey = "STRAIGHT_WIN" | "DOUBLE_CHANCE" | "BTTS" | "OVER_2_5";

export const MARKET_HUBS: readonly MarketHub[] = [
  {
    key: "STRAIGHT_WIN",
    href: "/predictions/straight-wins",
    label: "Straight Wins",
    desc: "Home win and away win picks: one team to win the match outright.",
  },
  {
    key: "DOUBLE_CHANCE",
    href: "/predictions/double-chance",
    label: "Double Chance",
    desc: "Home-or-Draw, Away-or-Draw and Home-or-Away picks with supporting evidence and settled results.",
  },
  {
    key: "BTTS",
    href: "/predictions/btts",
    label: "BTTS",
    desc: "Both Teams to Score Yes and No picks, with match evidence and the settled market record.",
  },
  {
    key: "OVER_2_5",
    href: "/predictions/over-2-5-goals",
    label: "Over 2.5",
    desc: "Matches assessed for at least three total goals, with the supporting evidence and settled record.",
  },
];

/** The paid tiers a market page leaves out. */
export const MARKET_HUB_EXCLUDED_CATEGORIES = ["VIP", "PREMIUM"] as const;

/** A straight win is a home or away win; a draw pick is not a win. Pure. */
export function isStraightWinSelection(selection: unknown): boolean {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) return false;
  const value = (selection as { value?: unknown }).value;
  return value === "HOME" || value === "AWAY";
}

/** True when a tip carries no VIP or Premium tag, primary or linked. Pure. */
export function isFreeTierRow(row: { category?: string | null; categories?: ReadonlyArray<{ category: string }> }): boolean {
  const paid = MARKET_HUB_EXCLUDED_CATEGORIES as readonly string[];
  if (row.category && paid.includes(row.category)) return false;
  return !(row.categories ?? []).some((c) => paid.includes(c.category));
}

type HubRow = {
  id: string;
  fixtureApiId?: number | null;
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  kickoff?: Date | string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  marketType: string;
  selection: unknown;
  confidence: number;
  categories?: readonly { category: string }[];
};

const stable = (v: unknown): string =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v as object).sort().map((k) => `${k}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
    : JSON.stringify(v ?? null);

/**
 * One entry per match and pick on a market page. Pure.
 *
 * A match can hold the same selection on two published rows: its own tip
 * (say the Goals pass's Over 2.5) and a hidden leg of its Combo Bet with the
 * same Over 2.5, which listed it twice on the Over 2.5 page (14 matches in two
 * weeks, Oct 2026). Only the repeat is dropped: the standalone tip is kept
 * over the combo leg, then the higher confidence. A match whose only row in
 * the market is a combo leg still appears, and every match stays on every
 * market page it belongs to.
 */
export function onePerMatchAndPick<T extends HubRow>(rows: readonly T[]): T[] {
  const isLeg = (r: T) => r.marketType !== "SAME_GAME_DOUBLE" && (r.categories ?? []).some((c) => c.category === "SAME_GAME_DOUBLE");
  const match = (r: T) => {
    if (r.fixtureApiId != null) return `f${r.fixtureApiId}`;
    const day = r.kickoff ? new Date(r.kickoff).toISOString().slice(0, 10) : "";
    return r.homeTeamApiId != null && r.awayTeamApiId != null ? `t${r.homeTeamApiId}-${r.awayTeamApiId}-${day}` : `n${r.homeTeam}|${r.awayTeam}|${day}`.toLowerCase();
  };
  const better = (a: T, b: T) => (isLeg(a) !== isLeg(b) ? !isLeg(a) : a.confidence > b.confidence);
  const kept = new Map<string, T>();
  for (const r of rows) {
    const key = `${match(r)}|${r.marketType}|${stable(r.selection)}`;
    const cur = kept.get(key);
    if (!cur || better(r, cur)) kept.set(key, r);
  }
  const keep = new Set(kept.values());
  return rows.filter((r) => keep.has(r));
}
