import assert from "node:assert/strict";
import { auditPaidSelectionConcentration } from "../src/lib/paidShadowIntegrity";
import type { PaidCandidateAssessment } from "../src/lib/paidValue";
const base = { provider: null, leagueApiId: 39, rawConfidence: 80, rule: { eligible: true, tag: "VIP_ROUTE" }, value: {} as PaidCandidateAssessment["value"] };
const rows: PaidCandidateAssessment[] = [
 { ...base, id: "a", fixtureKey: "fixture1", marketType: "BTTS", quoteAgeMinutes: 30 },
 { ...base, id: "b", fixtureKey: "fixture1", marketType: "OVER_2_5", quoteAgeMinutes: 30 },
 { ...base, id: "c", fixtureKey: "fixture2", marketType: "BTTS", quoteAgeMinutes: 400 },
];
const result = auditPaidSelectionConcentration(rows, ["a", "b", "c", "c", "unknown"]);
assert.equal(result.distinctFixtures, 2);
assert.equal(result.missingAssessment, 1);
assert.deepEqual(result.warnings.map(w => w.reason), [
 "CONTRADICTORY_OR_CORRELATED_FIXTURE", "QUOTE_OUTSIDE_FRESHNESS_WINDOW", "DUPLICATE_SELECTED_ID",
]);
console.log("paid shadow integrity: all assertions passed");
