import assert from "node:assert/strict";
import { evaluateShadowSegmentPolicy } from "../src/lib/paidHoldoutPolicy";
import type { SettledPaidObservation } from "../src/lib/paidMarketQuality";
const rows: SettledPaidObservation[] = Array.from({length: 120}, (_, i) => ({
  id: String(i), kickoff: new Date(Date.UTC(2026, 0, 1 + i)),
  marketType: i < 84 ? "BTTS" : "OVER_2_5", leagueApiId: 39, provider: null,
  odds: 2, priceSource: "entry", confidence: 80,
  outcome: i < 84 ? (i % 4 === 0 ? "LOST" : "WON") : (i % 3 === 0 ? "WON" : "LOST"),
}));
const result = evaluateShadowSegmentPolicy(rows, "market", {minTrainingSegment: 50, minTrainingPriced: 40});
assert.deepEqual(result.selectedTrainingKeys, ["BTTS"]);
assert.equal(result.training, 84);
assert.equal(result.validation, 36);
assert.equal(result.candidate.decided, 0);
assert.equal(result.activationAllowed, false);
assert.ok(result.warnings.includes("INSUFFICIENT_CANDIDATE_ENTRY_PRICES"));
const empty = evaluateShadowSegmentPolicy([], "market");
assert.equal(empty.activationAllowed, false);
assert.equal(empty.validation, 0);
console.log("paid holdout policy: all assertions passed");
