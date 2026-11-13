import type { PaidCandidateAssessment } from "./paidValue";

/** Shadow-only fixture concentration audit: no admission or ranking changes. */
export function auditPaidSelectionConcentration(
  assessments: readonly PaidCandidateAssessment[],
  selectedIds: readonly string[],
) {
  const byId = new Map(assessments.map(a => [a.id, a]));
  const seenIds = new Set<string>();
  const fixtures = new Map<string, { id: string; market: string }>();
  const markets: Record<string, number> = {};
  const warnings: Array<{ id: string; reason: string; relatedId?: string }> = [];
  let missingAssessment = 0;
  for (const id of selectedIds) {
    if (seenIds.has(id)) { warnings.push({ id, reason: "DUPLICATE_SELECTED_ID" }); continue; }
    seenIds.add(id);
    const row = byId.get(id);
    if (!row) { missingAssessment++; continue; }
    const prior = fixtures.get(row.fixtureKey);
    if (prior) {
      warnings.push({ id, relatedId: prior.id, reason: prior.market === row.marketType ? "CORRELATED_SAME_FIXTURE" : "CONTRADICTORY_OR_CORRELATED_FIXTURE" });
    } else fixtures.set(row.fixtureKey, { id, market: row.marketType });
    markets[row.marketType] = (markets[row.marketType] ?? 0) + 1;
    if (row.quoteAgeMinutes !== null && (row.quoteAgeMinutes < 0 || row.quoteAgeMinutes > 360))
      warnings.push({ id, reason: "QUOTE_OUTSIDE_FRESHNESS_WINDOW" });
  }
  return { selected: selectedIds.length, distinctFixtures: fixtures.size, missingAssessment,
    marketCounts: markets, warnings };
}
