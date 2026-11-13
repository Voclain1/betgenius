import assert from "node:assert/strict";
import { guardPaidCandidates, type PaidCandidate } from "../src/lib/paidIntegrityGuards";
const now = new Date("2026-11-13T12:00:00Z");
const base: PaidCandidate = {
 id: "a", fixtureId: "fixture-1", kickoff: new Date("2026-11-13T15:00:00Z"),
 market: "BTTS", selection: "YES", price: 1.8,
 quotedAt: new Date("2026-11-13T11:30:00Z"), confidence: 75,
};
const withChanges = (changes: Partial<PaidCandidate>): PaidCandidate => ({ ...base, ...changes });
const inputs: PaidCandidate[] = [
 base,
 withChanges({ id: "a" }),
 withChanges({ id: "b" }),
 withChanges({ id: "c", selection: "NO" }),
 withChanges({ id: "d", fixtureId: "fixture-2", quotedAt: new Date("2026-11-13T02:00:00Z") }),
 withChanges({ id: "e", fixtureId: "fixture-3", quotedAt: new Date("2026-11-13T12:01:00Z") }),
 withChanges({ id: "f", fixtureId: "fixture-4", kickoff: new Date("2026-11-13T12:05:00Z") }),
 withChanges({ id: "g", fixtureId: "fixture-5", price: 1 }),
 withChanges({ id: "h", fixtureId: "fixture-6", confidence: 110 }),
 withChanges({ id: "i", fixtureId: "fixture-7" }),
];
const result = guardPaidCandidates(inputs, now);
assert.deepEqual(result.accepted.map(x => x.id), ["a", "i"]);
assert.deepEqual(result.rejected.map(x => x.reason), [
 "DUPLICATE_ID", "DUPLICATE_MARKET", "CONTRADICTORY_MARKET",
 "STALE_OR_FUTURE_QUOTE", "STALE_OR_FUTURE_QUOTE",
 "KICKOFF_TOO_SOON", "INVALID_PRICE", "INVALID_CONFIDENCE",
]);
assert.throws(() => guardPaidCandidates([], now, { maxQuoteAgeMinutes: 0 }));
console.log("paid integrity guards: all assertions passed");
