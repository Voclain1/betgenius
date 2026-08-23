import assert from "node:assert/strict";
import { resolveMarket } from "../src/lib/markets";
import { regulationScoreOf } from "../src/lib/settlement";

// Real 2025/26 FA Cup response: Harefield United 3-2 Peacehaven after extra
// time, tied 2-2 after regulation, with a 1-0 extra-time period.
const faCupAet = regulationScoreOf({
  fixture: { status: { short: "AET" } },
  goals: { home: 3, away: 2 },
  score: {
    fulltime: { home: 2, away: 2 },
    extratime: { home: 1, away: 0 },
    penalty: { home: null, away: null },
  },
});
assert.deepEqual(faCupAet, { ok: true, home: 2, away: 2 });
if (!faCupAet.ok) throw new Error("Expected valid AET fixture");
assert.equal(resolveMarket("MATCH_WINNER", { value: "DRAW" }, faCupAet.home, faCupAet.away), "WON");
assert.equal(resolveMarket("MATCH_WINNER", { value: "HOME" }, faCupAet.home, faCupAet.away), "LOST");
assert.equal(resolveMarket("OVER_UNDER", { line: 4.5, direction: "UNDER" }, faCupAet.home, faCupAet.away), "WON");
assert.equal(resolveMarket("CORRECT_SCORE", { home: 2, away: 2 }, faCupAet.home, faCupAet.away), "WON");

// Real EFL Cup response: Barnet 2-2 Newport, Newport won shootout 4-2.
const eflPenalty = regulationScoreOf({
  fixture: { status: { short: "PEN" } },
  goals: { home: 2, away: 2 },
  score: {
    fulltime: { home: 2, away: 2 },
    extratime: { home: null, away: null },
    penalty: { home: 2, away: 4 },
  },
});
assert.deepEqual(eflPenalty, { ok: true, home: 2, away: 2 });
if (!eflPenalty.ok) throw new Error("Expected valid penalty fixture");
assert.equal(resolveMarket("DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }, eflPenalty.home, eflPenalty.away), "WON");
assert.equal(resolveMarket("MATCH_WINNER", { value: "AWAY" }, eflPenalty.home, eflPenalty.away), "LOST");

// Real Copa del Rey response observed during research: contradictory aggregate
// and component scores. This must be routed to manual settlement.
const inconsistent = regulationScoreOf({
  fixture: { status: { short: "AET" } },
  goals: { home: 2, away: 0 },
  score: {
    fulltime: { home: 4, away: 0 },
    extratime: { home: 0, away: 2 },
    penalty: { home: null, away: null },
  },
});
assert.equal(inconsistent.ok, false);

console.log("Settlement time-basis checks passed: AET and PEN use regulation only; inconsistent data fails closed.");
