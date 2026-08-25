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
import { compatible, type Leg } from "./measure-market-breadth";

let failures = 0;
function expect(label: string, a: Leg, b: Leg, want: "ok" | "REDUNDANT" | "CONTRADICTORY") {
  const v = compatible(a, b);
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

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
if (failures) process.exitCode = 1;
