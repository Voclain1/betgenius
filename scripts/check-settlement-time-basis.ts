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
assert.deepEqual(faCupAet, { ok: true, home: 2, away: 2, halftime: null });
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
assert.deepEqual(eflPenalty, { ok: true, home: 2, away: 2, halftime: null });
if (!eflPenalty.ok) throw new Error("Expected valid penalty fixture");
assert.equal(resolveMarket("DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }, eflPenalty.home, eflPenalty.away), "WON");
assert.equal(resolveMarket("MATCH_WINNER", { value: "AWAY" }, eflPenalty.home, eflPenalty.away), "LOST");

// Real Copa del Rey response: Universitario FC 1-3 Inter de Valdemoro after
// extra time, level 1-1 at the end of regulation.
const copaAet = regulationScoreOf({
  fixture: { status: { short: "AET" } },
  goals: { home: 1, away: 3 },
  score: {
    fulltime: { home: 1, away: 1 },
    extratime: { home: 0, away: 2 },
    penalty: { home: null, away: null },
  },
});
assert.deepEqual(copaAet, { ok: true, home: 1, away: 1, halftime: null });
if (!copaAet.ok) throw new Error("Expected valid Copa del Rey AET fixture");
assert.equal(resolveMarket("BTTS", { value: "YES" }, copaAet.home, copaAet.away), "WON");
assert.equal(resolveMarket("MATCH_WINNER", { value: "AWAY" }, copaAet.home, copaAet.away), "LOST");

// Real Coppa Italia response: Empoli 1-1 Reggiana, Empoli won 3-0 on pens.
const coppaPenalty = regulationScoreOf({
  fixture: { status: { short: "PEN" } },
  goals: { home: 1, away: 1 },
  score: {
    fulltime: { home: 1, away: 1 },
    extratime: { home: null, away: null },
    penalty: { home: 3, away: 0 },
  },
});
assert.deepEqual(coppaPenalty, { ok: true, home: 1, away: 1, halftime: null });
if (!coppaPenalty.ok) throw new Error("Expected valid Coppa Italia penalty fixture");
assert.equal(resolveMarket("CORRECT_SCORE", { home: 1, away: 1 }, coppaPenalty.home, coppaPenalty.away), "WON");
assert.equal(resolveMarket("MATCH_WINNER", { value: "HOME" }, coppaPenalty.home, coppaPenalty.away), "LOST");

// Real Coupe de France response: Pontarlier 2-2 Sochaux before a shootout.
// API-Football omitted the shootout tally. The defensive completeness rule
// therefore fails closed instead of guessing, even though regulation is shown.
const coupePenalty = regulationScoreOf({
  fixture: { status: { short: "PEN" } },
  goals: { home: 2, away: 2 },
  score: {
    fulltime: { home: 2, away: 2 },
    extratime: { home: null, away: null },
    penalty: { home: null, away: null },
  },
});
assert.equal(coupePenalty.ok, false);

// Real Copa del Rey response observed during research: contradictory aggregate
// and component scores. This must be routed to manual settlement.
// Half-time is part of the contract now: WIN_EITHER_HALF settles from it, so it
// must survive the regulation-score extraction rather than being dropped with
// extra time. An AET fixture keeps its REGULATION halves — extra-time goals
// belong to neither half.
const withHalftime = regulationScoreOf({
  fixture: { status: { short: "FT" } },
  goals: { home: 2, away: 1 },
  score: { halftime: { home: 0, away: 1 }, fulltime: { home: 2, away: 1 } },
} as any);
assert.deepEqual(withHalftime, { ok: true, home: 2, away: 1, halftime: { home: 0, away: 1 } });

// A finished fixture whose halftime the feed omits must still resolve its
// full-time score — only the halves-dependent market degrades, not settlement
// as a whole.
const missingHalftime = regulationScoreOf({
  fixture: { status: { short: "FT" } },
  goals: { home: 1, away: 0 },
  score: { fulltime: { home: 1, away: 0 } },
} as any);
assert.deepEqual(missingHalftime, { ok: true, home: 1, away: 0, halftime: null });

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
