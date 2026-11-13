import assert from "node:assert/strict";
import { paidReturnUncertainty } from "../src/lib/paidReturnUncertainty";
import type { SettledPaidObservation } from "../src/lib/paidMarketQuality";
const rows: SettledPaidObservation[] = Array.from({ length: 40 }, (_, i) => ({
 id: String(i), kickoff: new Date("2026-11-01"), marketType: "BTTS", leagueApiId: 39,
 provider: null, odds: i < 30 ? 2 : null, priceSource: i < 30 ? "entry" : "missing",
 confidence: 80, outcome: i % 2 ? "WON" : "LOST",
}));
const result = paidReturnUncertainty(rows);
assert.equal(result.priced, 30);
assert.equal(result.coverage, 0.75);
assert.equal(result.meanPct, 0);
assert.equal(result.warning, "LOW_PRICE_COVERAGE");
assert.ok(result.lower95Pct! < 0);
assert.equal(paidReturnUncertainty(rows.slice(0, 10)).lower95Pct, null);
console.log("paid return uncertainty: all assertions passed");
