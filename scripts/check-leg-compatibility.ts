/**
 * Asserts the leg-compatibility prototype against REAL pairs from the database.
 *
 * The yield run (measure-market-breadth.ts) produced zero rejections, which
 * tells us the prompt avoids bad pairs — but leaves the check itself unexercised.
 * A filter that has never rejected anything is not evidence of a working filter.
 * These are the actual redundant pairs the pipeline generated before the prompt
 * existed, so they are the cases that must still be caught if the prompt is ever
 * bypassed, edited, or a model ignores it.
 *
 * Run: npx tsx scripts/check-leg-compatibility.ts
 */
export {};
import { checkLegCompatibility, composeComboOutcome, comboConfidenceCeiling, type Leg } from "../src/lib/sameGameDouble";
import type { Outcome } from "../src/lib/enums";
import { AUTO_MARKET_TYPES, ADMIN_MARKET_TYPES, MARKET_TYPES, isValidSelection, resolveMarket } from "../src/lib/markets";

let failures = 0;
function expect(label: string, a: Leg, b: Leg, want: "ok" | "REDUNDANT" | "CONTRADICTORY") {
  const v = checkLegCompatibility(a, b);
  const got = v.ok ? "ok" : v.reason;
  const pass = got === want;
  if (!pass) failures++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label.padEnd(56)} want=${want} got=${got}${v.ok ? "" : ` (${v.detail})`}`);
}

const mw = (v: string): Leg => ({ marketType: "MATCH_WINNER", selection: { value: v } as any });
const dc = (v: string): Leg => ({ marketType: "DOUBLE_CHANCE", selection: { value: v } as any });
const ou = (line: number, direction: string): Leg => ({ marketType: "OVER_UNDER", selection: { line, direction } as any });
const btts = (v: string): Leg => ({ marketType: "BTTS", selection: { value: v } as any });
const weh = (v: string): Leg => ({ marketType: "WIN_EITHER_HALF", selection: { value: v } as any });
const cs = (h: number, a: number): Leg => ({ marketType: "CORRECT_SCORE", selection: { home: h, away: a } as any });

console.log("\nREAL pairs the pipeline actually generated (pre-prompt):");
// Ipswich v Sunderland — MATCH_WINNER Ipswich + DOUBLE_CHANCE Ipswich-or-Draw
expect("Ipswich: MW Home + DC Home-or-Draw", mw("HOME"), dc("HOME_OR_DRAW"), "REDUNDANT");
// Torpedo Zhodino v Dnepr — same shape
expect("Torpedo: MW Home + DC Home-or-Draw", mw("HOME"), dc("HOME_OR_DRAW"), "REDUNDANT");
// Ipswich also produced BTTS Yes alongside MW Home — this one IS assemblable
expect("Ipswich: MW Home + BTTS Yes", mw("HOME"), btts("YES"), "ok");
// Hull v Man Utd — MW Away + OU Over 2.5, and BTTS Yes + OU Over 2.5
expect("Hull: MW Away + Over 2.5", mw("AWAY"), ou(2.5, "OVER"), "ok");
expect("Hull: BTTS Yes + Over 2.5", btts("YES"), ou(2.5, "OVER"), "ok");

console.log("\nnesting that must be caught:");
expect("MW Home + DC Home-or-Away", mw("HOME"), dc("HOME_OR_AWAY"), "REDUNDANT");
expect("MW Home + WEH Home", mw("HOME"), weh("HOME"), "REDUNDANT");
expect("BTTS Yes + Over 1.5", btts("YES"), ou(1.5, "OVER"), "REDUNDANT");
expect("CORRECT_SCORE 2-1 + MW Home", cs(2, 1), mw("HOME"), "REDUNDANT");
expect("same market twice (OU + OU)", ou(2.5, "OVER"), ou(3.5, "UNDER"), "REDUNDANT");

console.log("\ncontradictions that must be caught:");
expect("MW Home + DC Away-or-Draw", mw("HOME"), dc("AWAY_OR_DRAW"), "CONTRADICTORY");
expect("BTTS Yes + Under 1.5", btts("YES"), ou(1.5, "UNDER"), "CONTRADICTORY");
expect("MW Home + WEH Away", mw("HOME"), weh("AWAY"), "CONTRADICTORY");
expect("DC Home-or-Draw + WEH Away", dc("HOME_OR_DRAW"), weh("AWAY"), "CONTRADICTORY");

console.log("\npairs that must stay allowed:");
expect("DC Home-or-Draw + Under 2.5", dc("HOME_OR_DRAW"), ou(2.5, "UNDER"), "ok");
expect("DC Home-or-Draw + BTTS No", dc("HOME_OR_DRAW"), btts("NO"), "ok");
expect("WEH Home + BTTS No", weh("HOME"), btts("NO"), "ok");
expect("WEH Home + Over 2.5", weh("HOME"), ou(2.5, "OVER"), "ok");
expect("BTTS Yes + Over 2.5 (line above implication)", btts("YES"), ou(2.5, "OVER"), "ok");
expect("BTTS No + Under 2.5", btts("NO"), ou(2.5, "UNDER"), "ok");


/* ---------------------------------------------------------------------- *
 * Outcome composition.
 * ---------------------------------------------------------------------- */

function expectOutcome(label: string, a: Outcome, b: Outcome, want: Outcome | null) {
  const got = composeComboOutcome(a, b);
  const pass = got === want;
  if (!pass) failures++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label.padEnd(56)} want=${want ?? "null"} got=${got ?? "null"}`);
}

console.log("\ncomposition — both legs must land:");
expectOutcome("WON + WON", "WON", "WON", "WON");
expectOutcome("WON + LOST", "WON", "LOST", "LOST");
expectOutcome("LOST + WON", "LOST", "WON", "LOST");
expectOutcome("LOST + LOST", "LOST", "LOST", "LOST");

console.log("\ncomposition — VOID propagates to the whole double:");
expectOutcome("VOID + WON", "VOID", "WON", "VOID");
expectOutcome("WON + VOID", "WON", "VOID", "VOID");
expectOutcome("VOID + VOID", "VOID", "VOID", "VOID");
// A void leg is NOT removed to reduce the double to its surviving leg, which
// is what a real book would do. See the note on composeComboOutcome.
expectOutcome("VOID + LOST voids rather than losing", "VOID", "LOST", "VOID");

console.log("\ncomposition — not yet settleable:");
expectOutcome("PENDING + WON", "PENDING", "WON", null);
expectOutcome("WON + PENDING", "WON", "PENDING", null);
expectOutcome("PENDING + PENDING", "PENDING", "PENDING", null);
expectOutcome("PENDING + LOST stays unsettled", "PENDING", "LOST", null);

console.log("\ncomposition is order-independent:");
const OUTCOMES: Outcome[] = ["PENDING", "WON", "LOST", "VOID"];
let asymmetric = 0;
for (const x of OUTCOMES) {
  for (const y of OUTCOMES) {
    if (composeComboOutcome(x, y) !== composeComboOutcome(y, x)) {
      asymmetric++;
      failures++;
      console.log(`  FAIL  ${x} + ${y} disagrees with its reverse`);
    }
  }
}
if (asymmetric === 0) console.log(`  PASS  all ${OUTCOMES.length ** 2} ordered pairs agree with their reverse`);

console.log("\nconfidence ceiling is a bound, never a product:");
function expectCeiling(a: number, b: number, want: number) {
  const got = comboConfidenceCeiling(a, b);
  const pass = got === want;
  if (!pass) failures++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ceiling(${a}, ${b})`.padEnd(58) + ` want=${want} got=${got}`);
}
expectCeiling(72, 62, 62);
expectCeiling(62, 72, 62);
expectCeiling(70, 70, 70);
// The independence product here would be 45%. It must NOT be what we return:
// correlated legs make that number wrong in an unknown direction, whereas
// min() is true under every correlation.
const product = Math.round((72 * 62) / 100);
if (comboConfidenceCeiling(72, 62) === product) {
  failures++;
  console.log(`  FAIL  ceiling returned the independence product (${product}) instead of the bound`);
} else {
  console.log(`  PASS  ceiling is the bound (62), not the independence product (${product})`);
}


/* ---------------------------------------------------------------------- *
 * Guards: a double must never be generated, typed in, or scoreline-resolved.
 * ---------------------------------------------------------------------- */

function check(label: string, ok: boolean) {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
}

console.log("\nguards:");
check(
  "SAME_GAME_DOUBLE is a real market type",
  (MARKET_TYPES as readonly string[]).includes("SAME_GAME_DOUBLE"),
);
// AUTO_MARKET_TYPES is interpolated into the model's instructions. A double
// there would invite the model to emit legIds pointing at nothing.
check(
  "the AI is never offered SAME_GAME_DOUBLE",
  !(AUTO_MARKET_TYPES as readonly string[]).includes("SAME_GAME_DOUBLE"),
);
// The generic admin editor cannot check that two hand-typed legs share a
// fixture or do not contradict each other.
check(
  "the admin editor cannot set SAME_GAME_DOUBLE",
  !(ADMIN_MARKET_TYPES as readonly string[]).includes("SAME_GAME_DOUBLE"),
);
check(
  "the admin editor still offers every other market type",
  MARKET_TYPES.filter((m) => m !== "SAME_GAME_DOUBLE").every((m) =>
    (ADMIN_MARKET_TYPES as readonly string[]).includes(m),
  ),
);
// resolveMarket stays a pure scoreline resolver: a double has no scoreline
// that settles it, so it must decline rather than guess.
check(
  "resolveMarket refuses a double even with a valid selection",
  resolveMarket("SAME_GAME_DOUBLE", { legIds: ["a", "b"] } as never, 2, 1) === null,
);
check(
  "resolveMarket refuses a double on every scoreline",
  [[0, 0], [1, 0], [0, 1], [3, 3]].every(([h, a]) =>
    resolveMarket("SAME_GAME_DOUBLE", { legIds: ["a", "b"] } as never, h, a) === null,
  ),
);

console.log("\nselection validation:");
check("accepts exactly two distinct ids", isValidSelection("SAME_GAME_DOUBLE", { legIds: ["a", "b"] }));
check("rejects one id", !isValidSelection("SAME_GAME_DOUBLE", { legIds: ["a"] }));
check("rejects three ids", !isValidSelection("SAME_GAME_DOUBLE", { legIds: ["a", "b", "c"] }));
// A row doubled with itself would settle as that row while presenting as a
// compound pick — strictly worse than not existing.
check("rejects the same id twice", !isValidSelection("SAME_GAME_DOUBLE", { legIds: ["a", "a"] }));
check("rejects empty ids", !isValidSelection("SAME_GAME_DOUBLE", { legIds: ["", "b"] }));
check("rejects non-string ids", !isValidSelection("SAME_GAME_DOUBLE", { legIds: [1, 2] }));
check("rejects a missing legIds", !isValidSelection("SAME_GAME_DOUBLE", {}));
check("rejects null", !isValidSelection("SAME_GAME_DOUBLE", null));

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
if (failures) process.exitCode = 1;
