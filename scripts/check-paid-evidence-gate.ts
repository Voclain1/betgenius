import assert from "node:assert/strict";
import { assessPaidEvidenceReadiness } from "../src/lib/paidEvidenceGate";
import type { SettledPaidObservation } from "../src/lib/paidMarketQuality";
const empty = assessPaidEvidenceReadiness([], []);
assert.equal(empty.activationAllowed, false);
assert.ok(empty.blockers.includes("INSUFFICIENT_SETTLED_HISTORY"));
assert.ok(empty.blockers.includes("PROSPECTIVE_POINT_IN_TIME_VALIDATION_REQUIRED"));
const rows: SettledPaidObservation[] = Array.from({length: 240}, (_, i) => ({
 id: String(i), kickoff: new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 4))),
 marketType: "BTTS", leagueApiId: 39, provider: null,
 odds: i < 200 ? 2 : null, priceSource: i < 200 ? "entry" : "missing",
 confidence: 80, outcome: i % 2 ? "WON" : "LOST",
}));
const report = assessPaidEvidenceReadiness(rows, []);
assert.equal(report.decided, 240);
assert.equal(report.entryPriced, 200);
assert.ok(report.coverage > 0.8);
assert.ok(report.blockers.includes("NO_HOLDOUT_POLICY_EVALUATION"));
assert.equal(report.activationAllowed, false);
console.log("paid evidence gate: all assertions passed");
