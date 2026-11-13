import type { SettledPaidObservation } from "./paidMarketQuality";

/** Deterministic, conservative normal approximation for average unit-stake return.
 * Analytical only; independence is not guaranteed for football picks.
 */
export function paidReturnUncertainty(rows: readonly SettledPaidObservation[], minSample = 30) {
  const decided = rows.filter(r => r.outcome === "WON" || r.outcome === "LOST");
  const priced = decided.filter(r => r.priceSource === "entry" && r.odds !== null && Number.isFinite(r.odds) && r.odds > 1);
  const n = priced.length;
  const fixtureDays = new Set(priced.map(r => r.kickoff.toISOString().slice(0, 10))).size;
  const coverage = decided.length ? n / decided.length : 0;
  if (n < minSample) return { decided: decided.length, priced: n, fixtureDays, coverage, meanPct: null, lower95Pct: null, upper95Pct: null, warning: "INSUFFICIENT_PRICED_SAMPLE" as const };
  const returns = priced.map(r => r.outcome === "WON" ? r.odds! - 1 : -1);
  const mean = returns.reduce((s, x) => s + x, 0) / n;
  const variance = returns.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  const margin = 1.96 * Math.sqrt(variance / n);
  return { decided: decided.length, priced: n, fixtureDays, coverage, meanPct: mean * 100, lower95Pct: (mean - margin) * 100, upper95Pct: (mean + margin) * 100,
    warning: coverage < 0.8 ? "LOW_PRICE_COVERAGE" as const : fixtureDays < 10 ? "TEMPORAL_CONCENTRATION" as const : "NORMAL_APPROXIMATION_CORRELATION_UNMODELED" as const };
}
