import assert from "node:assert/strict";
import { calculateSlip } from "../src/lib/betBuilderMath";

const manualOnly = calculateSlip([{ odds: 1.8 }, { odds: 2.1 }], 10);
assert.ok(manualOnly);
assert.ok(Math.abs(manualOnly.combinedOdds - 3.78) < 1e-10);
assert.ok(Math.abs(manualOnly.potentialReturn - 37.8) < 1e-10);
assert.equal(calculateSlip([{ odds: null }], 10), null);
assert.equal(calculateSlip([{ odds: 1.8 }, { odds: null }], 10), null);

console.log("Bet Builder verification passed: manual-only calculates; tips-only and mixed slips do not.");
