import assert from "node:assert/strict";
import { chronologicalHoldout, validationWarnings } from "../src/lib/paidChronologicalValidation";
import type { SettledPaidObservation } from "../src/lib/paidMarketQuality";
const observation = (i: number, kickoff = new Date(Date.UTC(2026, 0, 1 + i))): SettledPaidObservation => ({
 id: String(i), kickoff, marketType: i % 2 ? "BTTS" : "OVER_2_5",
 leagueApiId: 39, provider: "test", odds: 1.8, priceSource: "entry",
 confidence: 75, outcome: i % 3 ? "WON" : "LOST",
});
const rows = Array.from({ length: 100 }, (_, i) => observation(i));
const r = chronologicalHoldout([...rows].reverse(), "market");
assert.equal(r.trainingCount, 70);
assert.equal(r.validationCount, 30);
assert.equal(r.splitAt, rows[70].kickoff.toISOString());
assert.equal(r.training.reduce((s, x) => s + x.decided, 0), 70);
assert.equal(r.validation.reduce((s, x) => s + x.decided, 0), 30);
assert(!r.warnings.length);
const tied = chronologicalHoldout([observation(1), observation(2, rows[1].kickoff), observation(3, rows[1].kickoff)], "market", { minTraining: 0, minValidation: 0 });
assert.equal(tied.trainingCount, 0);
assert.equal(tied.validationCount, 3);
assert.throws(() => chronologicalHoldout(rows, "market", { validationFraction: 1 }));
assert(validationWarnings(chronologicalHoldout(rows.slice(0, 10), "market")).includes("INSUFFICIENT_TRAINING_SAMPLE"));
console.log("paid chronological holdout: all assertions passed");
