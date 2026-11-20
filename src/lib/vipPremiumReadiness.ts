import { experimentalDays, fixtureRichnessByDay, type RichnessFixture } from "./vipQuotaExperiment";
import type { PaidOddsDiagnostic } from "./vipPremiumOverlay";

export const PAID_ODDS_SAMPLE_LIMIT = 20;
const validId = (id: number | null) => Number.isSafeInteger(id) && id! > 0;
const counts = (values: string[]) => values.reduce<Record<string, number>>((out, key) => { out[key] = (out[key] ?? 0) + 1; return out; }, {});

/** Observability only: never publishes, retries, clears a block or changes a gate. */
export function paidPublicationOutcome(input: { evaluated: number; promoted: number; published: number; publishHeld: number; heldForRequote: number; generationFailed: number }) {
  if (input.published > 0) return "PUBLISHED";
  if (input.publishHeld > 0) return "PUBLICATION_SAFETY_HOLD";
  if (input.heldForRequote > 0) return "AWAITING_REQUOTE";
  if (input.promoted > 0) return "UNEXPLAINED_PROMOTION_WITHOUT_PUBLICATION";
  if (input.evaluated > 0) return "NO_QUALIFYING_DRAFT";
  if (input.generationFailed > 0) return "GENERATION_FAILED";
  return "NO_GENERATION_OUTPUT";
}

/** All observations counted; samples bounded independently of warming budgets. */
export function summarisePaidOdds(rows: readonly PaidOddsDiagnostic[]) {
  return {
    candidateObservations: rows.length,
    uniqueFixtures: new Set(rows.map(r => r.fixtureApiId)).size,
    cache: counts(rows.map(r => r.cacheState)), warming: counts(rows.map(r => r.warmReason)),
    provider: counts(rows.map(r => r.providerFailure)), market: counts(rows.map(r => r.marketState)),
    sampleLimit: PAID_ODDS_SAMPLE_LIMIT, samples: rows.slice(0, PAID_ODDS_SAMPLE_LIMIT),
  };
}

/** Does not authorize extra attempts or replace the existing quota counters. */
export function paidFixtureReadiness(used: readonly RichnessFixture[], eligible: readonly RichnessFixture[]) {
  const union = fixtureRichnessByDay(used, eligible);
  const usedIds = new Set(used.filter(r => validId(r.fixtureApiId)).map(r => r.fixtureApiId));
  const rich = experimentalDays(used, eligible, 1);
  const days = [...new Set([...used.map(r => r.day), ...eligible.map(r => r.day)])].sort();
  return days.map(day => {
    const records = used.filter(r => r.day === day);
    const uniqueUsed = [...new Set(records.filter(r => validId(r.fixtureApiId)).map(r => r.fixtureApiId!))];
    const uniqueEligible = [...new Set(eligible.filter(r => r.day === day && validId(r.fixtureApiId) && !usedIds.has(r.fixtureApiId)).map(r => r.fixtureApiId!))];
    return {
      day, attemptRecords: records.length, uniqueUsedFixtureIds: uniqueUsed,
      missingIdentityRecords: records.filter(r => !validId(r.fixtureApiId)).length,
      repeatedIdentityRecords: records.filter(r => validId(r.fixtureApiId)).length - uniqueUsed.length,
      uniqueEligibleFixtureIds: uniqueEligible, uniqueUsedPlusEligible: union.get(day)?.size ?? 0,
      fixtureRich: rich.has(day),
    };
  });
}
