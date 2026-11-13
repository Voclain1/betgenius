import { computeStat, type WinRateStat } from "@/lib/trackRecord";

/**
 * The VIP / Premium performance record shown to subscribers. Pure.
 *
 * DEFINITIONS — the same everywhere on the site (computeStat):
 *   - Only settled picks count. PENDING is never a win or a loss.
 *   - Win rate = won / (won + lost). A VOID (draw no bet on a draw, a
 *     postponement) returns the stake: it is shown, never counted as either.
 *   - Return = flat one-unit stake per pick, profit / units staked, at the
 *     stated price. Voids return the stake and are left out of the stake count.
 *
 * TWO KINDS OF PRICE, NEVER MIXED.
 *   - RECORDED entry price: the median bookmaker price frozen on a dedicated
 *     pick when it was published (marketConfirmation.entryPrice, recorded from
 *     13 Nov 2026). This is the price a subscriber could actually have taken.
 *   - CLOSING reference price: the median of the last bookmaker quote stored
 *     before kickoff. A real price, but taken later than publication, so it
 *     says how the market closed, not what a subscriber got.
 * A return figure is shown for each only once PAID_RETURN_MIN_SAMPLE picks with
 * that kind of price have settled; below that the sample says nothing.
 */
export const PAID_RETURN_MIN_SAMPLE = 30;
export const PAID_MARKET_MIN_SAMPLE = 30;
export const PAID_RECENT_LIMIT = 10;

export type PaidPerformanceRow = {
  id: string;
  kickoff: Date;
  marketType: string;
  market: string;
  pick: string;
  homeTeam: string | null;
  awayTeam: string | null;
  leagueName: string | null;
  outcome: string;
  /** Recorded entry price, or null. */
  entryPrice: number | null;
  /** Closing reference price, or null. */
  closingPrice: number | null;
};

export type PriceReturn = {
  /** Settled, non-void picks carrying this kind of price. */
  priced: number;
  /** Of all settled non-void picks, the share that carry it. */
  coverage: number;
  averageOdds: number | null;
  /** Null until `priced` reaches PAID_RETURN_MIN_SAMPLE. */
  returnPct: number | null;
  /** Profit in units over those picks; null with returnPct. */
  units: number | null;
};

export type PaidPerformance = {
  since: string;
  record: WinRateStat;
  pending: number;
  entry: PriceReturn;
  closing: PriceReturn;
  byMarket: Array<{ marketType: string; label: string; record: WinRateStat; closingReturnPct: number | null }>;
  recent: PaidPerformanceRow[];
};

const SETTLED = new Set(["WON", "LOST", "VOID"]);

export function priceReturn(rows: readonly PaidPerformanceRow[], price: (r: PaidPerformanceRow) => number | null): PriceReturn {
  const decided = rows.filter((r) => r.outcome === "WON" || r.outcome === "LOST");
  const priced = decided.filter((r) => { const p = price(r); return p != null && p > 1; });
  const avg = priced.length ? priced.reduce((s, r) => s + price(r)!, 0) / priced.length : null;
  const units = priced.reduce((s, r) => s + (r.outcome === "WON" ? price(r)! - 1 : -1), 0);
  const enough = priced.length >= PAID_RETURN_MIN_SAMPLE;
  return {
    priced: priced.length,
    coverage: decided.length ? priced.length / decided.length : 0,
    averageOdds: avg,
    returnPct: enough ? (100 * units) / priced.length : null,
    units: enough ? units : null,
  };
}

const MARKET_LABELS: Record<string, string> = {
  MATCH_WINNER: "Match winner",
  DOUBLE_CHANCE: "Double chance",
  DRAW_NO_BET: "Draw no bet",
  OVER_UNDER: "Total goals",
  BTTS: "Both teams to score",
  TEAM_TOTAL: "Team goals",
};

export function computePaidPerformance(rows: readonly PaidPerformanceRow[], since: string, now: Date): PaidPerformance {
  const past = rows.filter((r) => r.kickoff.getTime() <= now.getTime());
  const settled = past.filter((r) => SETTLED.has(r.outcome));
  const byMarket = new Map<string, PaidPerformanceRow[]>();
  for (const r of settled) (byMarket.get(r.marketType) ?? byMarket.set(r.marketType, []).get(r.marketType)!).push(r);
  return {
    since,
    record: computeStat(settled.map((r) => r.outcome)),
    pending: past.filter((r) => !SETTLED.has(r.outcome)).length,
    entry: priceReturn(settled, (r) => r.entryPrice),
    closing: priceReturn(settled, (r) => r.closingPrice),
    byMarket: [...byMarket.entries()]
      .filter(([, rs]) => rs.length >= PAID_MARKET_MIN_SAMPLE)
      .map(([m, rs]) => ({ marketType: m, label: MARKET_LABELS[m] ?? m, record: computeStat(rs.map((r) => r.outcome)), closingReturnPct: priceReturn(rs, (r) => r.closingPrice).returnPct }))
      .sort((a, b) => b.record.total - a.record.total),
    recent: [...settled].sort((a, b) => b.kickoff.getTime() - a.kickoff.getTime() || a.id.localeCompare(b.id)).slice(0, PAID_RECENT_LIMIT),
  };
}

// ── Pick status on the card ─────────────────────────────────────────────────

export type PaidPickStatus = "UPCOMING" | "LIVE" | "AWAITING_RESULT" | "WON" | "LOST" | "VOID";

/** Regulation plus stoppage and half-time; after this a pending pick is awaiting its result, not live. */
export const MATCH_DURATION_MS = 125 * 60_000;

export function paidPickStatus(kickoff: Date | string | null | undefined, outcome: string | null | undefined, now: Date): PaidPickStatus | null {
  if (outcome === "WON" || outcome === "LOST" || outcome === "VOID") return outcome;
  if (!kickoff) return null;
  const k = new Date(kickoff).getTime();
  if (Number.isNaN(k)) return null;
  if (now.getTime() < k) return "UPCOMING";
  if (now.getTime() < k + MATCH_DURATION_MS) return "LIVE";
  return "AWAITING_RESULT";
}

export const PAID_STATUS_LABELS: Record<PaidPickStatus, string> = {
  UPCOMING: "Upcoming",
  LIVE: "In play",
  AWAITING_RESULT: "Awaiting result",
  WON: "Won",
  LOST: "Lost",
  VOID: "Void · stake returned",
};

/**
 * Why a pick is in the paid feed, in one honest sentence. Built only from what
 * is stored on the row: the dedicated pass's frozen market confirmation, or
 * the tier's published confidence bar. No expected value, no promise.
 */
export function paidSelectionReason(row: { marketConfirmation?: unknown; confidence: number | null }, tier: "VIP" | "PREMIUM"): string {
  const mc = row.marketConfirmation as { modelProbability?: number; marketProbability?: number } | null | undefined;
  const bar = tier === "PREMIUM" ? 80 : 75;
  if (mc && typeof mc.marketProbability === "number" && typeof mc.modelProbability === "number") {
    return `Picked for ${tier === "PREMIUM" ? "Premium" : "VIP"}: our analysis rates it ${Math.round(mc.modelProbability)}% and the bookmakers' prices imply ${Math.round(mc.marketProbability)}% — two independent reads that agree.`;
  }
  return `In ${tier === "PREMIUM" ? "Premium" : "VIP"} because our analysis rates it at or above the ${bar}% confidence bar.`;
}
