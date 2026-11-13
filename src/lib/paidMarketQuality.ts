/**
 * VIP Sprint 04: pure, conservative segmentation of settled paid picks.
 *
 * This is an analytical tool, not a live-selection rule. In particular,
 * a profitable-looking segment must never be activated from an in-sample scan.
 */
export type SettledPaidObservation = {
  id: string;
  kickoff: Date;
  marketType: string;
  leagueApiId: number | null;
  provider: string | null;
  odds: number | null;
  priceSource: "entry" | "closing" | "missing";
  confidence: number | null;
  outcome: "WON" | "LOST" | "VOID";
};

export type SegmentDimension = "market" | "league" | "provider" | "oddsBand" | "confidenceBand";
export type SegmentResult = {
  dimension: SegmentDimension;
  key: string;
  decided: number;
  voids: number;
  wins: number;
  losses: number;
  winRate: number | null;
  winRateWilson95: [number, number] | null;
  priced: number;
  pricedCoverage: number;
  entryPriced: number;
  closingPriced: number;
  roiPct: number | null;
  roiSource: "entry" | "closing" | null;
  warning: string[];
};

export function wilson95(wins: number, decided: number): [number, number] | null {
  if (!Number.isInteger(wins) || !Number.isInteger(decided) || decided <= 0 || wins < 0 || wins > decided) return null;
  const z = 1.959963984540054;
  const p = wins / decided;
  const den = 1 + z * z / decided;
  const mid = (p + z * z / (2 * decided)) / den;
  const rad = z * Math.sqrt((p * (1 - p) + z * z / (4 * decided)) / decided) / den;
  return [Math.max(0, mid - rad), Math.min(1, mid + rad)];
}

export function oddsBand(odds: number | null): string {
  if (odds === null || !Number.isFinite(odds) || odds <= 1) return "unpriced";
  if (odds < 1.2) return "1.01–1.19";
  if (odds < 1.5) return "1.20–1.49";
  if (odds < 1.8) return "1.50–1.79";
  if (odds < 2) return "1.80–1.99";
  return "2.00+";
}

export function confidenceBand(confidence: number | null): string {
  if (confidence === null || !Number.isFinite(confidence) || confidence < 0 || confidence > 100) return "unknown";
  const lower = Math.min(90, Math.floor(confidence / 10) * 10);
  return lower === 90 ? "90–100" : `${lower}–${lower + 9}`;
}

function segmentKey(r: SettledPaidObservation, dimension: SegmentDimension): string {
  switch (dimension) {
    case "market": return r.marketType || "unknown";
    case "league": return r.leagueApiId === null ? "unknown" : String(r.leagueApiId);
    case "provider": return r.provider || "unknown";
    case "oddsBand": return oddsBand(r.odds);
    case "confidenceBand": return confidenceBand(r.confidence);
  }
}

/** Never mix entry and closing prices in a return calculation. */
export function segmentPaidPerformance(
  rows: readonly SettledPaidObservation[],
  dimension: SegmentDimension,
  opts: { minRoiSample?: number; minWinRateSample?: number; source?: "entry" | "closing" } = {},
): SegmentResult[] {
  const minRoiSample = opts.minRoiSample ?? 30;
  const minWinRateSample = opts.minWinRateSample ?? 30;
  const source = opts.source ?? "entry";
  const groups = new Map<string, SettledPaidObservation[]>();
  for (const row of rows) {
    const key = segmentKey(row, dimension);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const decided = group.filter(r => r.outcome === "WON" || r.outcome === "LOST");
    const wins = decided.filter(r => r.outcome === "WON").length;
    const voids = group.length - decided.length;
    const priced = decided.filter(r => r.odds !== null && Number.isFinite(r.odds) && r.odds > 1 && r.priceSource === source);
    const entryPriced = decided.filter(r => r.priceSource === "entry" && r.odds !== null && Number.isFinite(r.odds) && r.odds > 1).length;
    const closingPriced = decided.filter(r => r.priceSource === "closing" && r.odds !== null && Number.isFinite(r.odds) && r.odds > 1).length;
    const warning: string[] = [];
    if (decided.length < minWinRateSample) warning.push("SMALL_WIN_RATE_SAMPLE");
    if (priced.length < minRoiSample) warning.push("INSUFFICIENT_PRICED_SAMPLE");
    if (decided.length && priced.length / decided.length < 0.8) warning.push("LOW_PRICE_COVERAGE");
    if (source === "closing") warning.push("CLOSING_PRICE_NOT_EXECUTABLE_ENTRY");
    const profit = priced.reduce((sum, r) => sum + (r.outcome === "WON" ? r.odds! - 1 : -1), 0);
    return {
      dimension, key, decided: decided.length, voids, wins, losses: decided.length - wins,
      winRate: decided.length ? wins / decided.length : null,
      winRateWilson95: wilson95(wins, decided.length),
      priced: priced.length,
      pricedCoverage: decided.length ? priced.length / decided.length : 0,
      entryPriced, closingPriced,
      roiPct: priced.length >= minRoiSample ? 100 * profit / priced.length : null,
      roiSource: priced.length >= minRoiSample ? source : null,
      warning,
    };
  }).sort((a, b) => b.decided - a.decided || a.key.localeCompare(b.key));
}
