import assert from "node:assert/strict";
import { confidenceBand, oddsBand, segmentPaidPerformance, wilson95, type SettledPaidObservation } from "../src/lib/paidMarketQuality";

const at = new Date("2026-11-01T12:00:00Z");
const row = (id: string, outcome: "WON" | "LOST" | "VOID", odds: number | null, priceSource: "entry" | "closing" | "missing" = "entry"): SettledPaidObservation => ({
  id, kickoff: at, marketType: "BTTS", leagueApiId: 39, provider: "test", odds,
  priceSource, confidence: 80, outcome,
});
assert.equal(wilson95(0, 0), null);
assert.deepEqual(wilson95(1, 1)?.map(x => Number(x.toFixed(3))), [0.207, 1]);
assert.equal(oddsBand(1.19), "1.01–1.19");
assert.equal(oddsBand(1.2), "1.20–1.49");
assert.equal(oddsBand(null), "unpriced");
assert.equal(confidenceBand(99), "90–100");
assert.equal(confidenceBand(null), "unknown");

const rows = [
  row("a", "WON", 2),
  row("b", "LOST", 1.5),
  row("c", "VOID", 1.5),
  row("d", "WON", 2, "closing"),
  row("e", "WON", null, "missing"),
];
const entry = segmentPaidPerformance(rows, "market", { minRoiSample: 2 })[0];
assert.equal(entry.decided, 4);
assert.equal(entry.voids, 1);
assert.equal(entry.wins, 3);
assert.equal(entry.priced, 2);
assert.equal(entry.entryPriced, 2);
assert.equal(entry.closingPriced, 1);
assert.equal(entry.roiPct, 0);
assert.equal(entry.roiSource, "entry");
assert(entry.warning.includes("LOW_PRICE_COVERAGE"));
const closing = segmentPaidPerformance(rows, "market", { minRoiSample: 1, source: "closing" })[0];
assert.equal(closing.priced, 1);
assert.equal(closing.roiPct, 100);
assert(closing.warning.includes("CLOSING_PRICE_NOT_EXECUTABLE_ENTRY"));
assert.equal(segmentPaidPerformance(rows, "market")[0].roiPct, null);
assert.equal(segmentPaidPerformance(rows, "league")[0].key, "39");
assert.equal(segmentPaidPerformance(rows, "oddsBand").length, 3);
console.log("paid market quality: all assertions passed");
