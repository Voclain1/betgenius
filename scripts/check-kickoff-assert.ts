/**
 * The kickoff assertion has to fire on divergence and stay silent otherwise.
 *
 * It guards a defect that the current code cannot reproduce (see
 * src/lib/generation/kickoffAssert.ts), which means the ONLY way to know it
 * still works is to feed it a fabricated mismatch. A guard for a bug you can no
 * longer trigger is exactly the kind that rots unnoticed.
 *
 * Run: npx tsx scripts/check-kickoff-assert.ts
 */
export {};

import { findKickoffMismatches, formatKickoffMismatches, KICKOFF_ASSERT_TOLERANCE_MS } from "../src/lib/generation/kickoffAssert";

const BASE = new Date("2026-08-26T18:45:00.000Z");
const at = (ms: number) => new Date(BASE.getTime() + ms);
const MIN = 60_000;

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

console.log("stays silent when the stored kickoff agrees:");
check("exact match", findKickoffMismatches(BASE, [{ id: "a", kickoff: at(0) }]).length === 0);
check("+30s is clock noise, not divergence", findKickoffMismatches(BASE, [{ id: "a", kickoff: at(30_000) }]).length === 0);
check("exactly at tolerance is still silent", findKickoffMismatches(BASE, [{ id: "a", kickoff: at(KICKOFF_ASSERT_TOLERANCE_MS) }]).length === 0);
check("several agreeing rows", findKickoffMismatches(BASE, [
  { id: "a", kickoff: at(0) }, { id: "b", kickoff: at(0) }, { id: "c", kickoff: at(0) },
]).length === 0);

console.log("\nFIRES on the real historical divergences:");
// Tottenham vs Charlton: attempt stored 18:45, prediction stored 17:45.
const tottenham = findKickoffMismatches(BASE, [{ id: "tottenham", kickoff: at(-60 * MIN) }]);
check("-60min (Tottenham vs Charlton)", tottenham.length === 1 && tottenham[0].deltaMinutes === -60,
  tottenham.length ? `delta=${tottenham[0].deltaMinutes}` : "did not fire");
// Real Madrid vs Real Sociedad: attempt 19:00, prediction 17:00.
const madrid = findKickoffMismatches(BASE, [{ id: "madrid", kickoff: at(-120 * MIN) }]);
check("-120min (Real Madrid vs Real Sociedad)", madrid.length === 1 && madrid[0].deltaMinutes === -120,
  madrid.length ? `delta=${madrid[0].deltaMinutes}` : "did not fire");
// Celtic vs Falkirk drifted the other way.
const celtic = findKickoffMismatches(BASE, [{ id: "celtic", kickoff: at(60 * MIN) }]);
check("+60min (drift in the opposite direction)", celtic.length === 1 && celtic[0].deltaMinutes === 60,
  celtic.length ? `delta=${celtic[0].deltaMinutes}` : "did not fire");
check("just past tolerance fires", findKickoffMismatches(BASE, [{ id: "a", kickoff: at(KICKOFF_ASSERT_TOLERANCE_MS + 1000) }]).length === 1);

console.log("\nFIRES on a null kickoff (generate.ts writes undefined on an unparseable date):");
const nulls = findKickoffMismatches(BASE, [{ id: "n", kickoff: null }]);
check("null is reported", nulls.length === 1 && nulls[0].actual === null);
check("null carries no delta", nulls.length === 1 && nulls[0].deltaMinutes === null);

console.log("\nreports only the offending rows out of a mixed batch:");
const mixed = findKickoffMismatches(BASE, [
  { id: "good1", kickoff: at(0) },
  { id: "bad", kickoff: at(-120 * MIN) },
  { id: "good2", kickoff: at(15_000) },
]);
check("1 of 3 flagged", mixed.length === 1, `flagged=${mixed.map((m) => m.predictionId).join(",")}`);
check("the flagged row is the bad one", mixed[0]?.predictionId === "bad");

console.log("\nthe log line says what happened:");
const msg = formatKickoffMismatches("Real Madrid vs Real Sociedad", madrid);
check("names the fixture", msg.includes("Real Madrid vs Real Sociedad"));
check("shows expected and stored", msg.includes(BASE.toISOString()) && msg.includes(at(-120 * MIN).toISOString()));
check("shows the signed delta", msg.includes("-120min"));
check("names the prediction id", msg.includes("madrid"));

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
