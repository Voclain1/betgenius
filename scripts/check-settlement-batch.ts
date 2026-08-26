import assert from "node:assert/strict";
import { SETTLEMENT_BATCH_LIMIT, resolveSettlementBatchLimit } from "../src/lib/settlementBatch";

assert.equal(SETTLEMENT_BATCH_LIMIT, 18);
assert.equal(resolveSettlementBatchLimit(null), 18);
assert.equal(resolveSettlementBatchLimit("40"), 18);
assert.equal(resolveSettlementBatchLimit("60"), 18);
assert.equal(resolveSettlementBatchLimit("12"), 12);
assert.equal(resolveSettlementBatchLimit("1"), 1);
assert.equal(resolveSettlementBatchLimit("0"), 18);
assert.equal(resolveSettlementBatchLimit("invalid"), 18);

console.log("PASS — settlement batch remains capped at the measured 18-item ceiling");
