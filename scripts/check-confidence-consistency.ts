/**
 * The confidence-as-second-signal rule for straight winners.
 *
 * Context, measured rather than assumed. Across 464 generations created after
 * b55589f deployed, MATCH_WINNER fell to 5.2% while DOUBLE_CHANCE rose to
 * 64.2% — that commit refined the choice WITHIN the hedge family but never
 * widened the entrance to MATCH_WINNER, which is still gated on market
 * lopsidedness alone. In the EXTREME band, where the prompt says to take the
 * straight winner, it was chosen 1 time in 18.
 *
 * This rule adds the model's own stated confidence as a second, independent
 * route in. It is a consistency check, not a quota and not a conversion.
 *
 * Read-only, no model calls. Run: npx tsx scripts/check-confidence-consistency.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

async function main() {
  const { buildSystemPrompt, HEDGE_CONFIDENCE_REVIEW_THRESHOLD } = await import("../src/lib/ai/analysis");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  // The prompt is a wrapped template literal, so a phrase can be split across a
  // line break mid-sentence. Collapse whitespace before matching, or assertions
  // pass or fail on where the text happens to wrap rather than on what it says.
  const flat = (s: string) => s.replace(/\s+/g, " ");
  const margin = flat(buildSystemPrompt(["FEATURED"], "margin", "single"));
  const tiered = flat(buildSystemPrompt(["GENIUS"], "tiered", "single"));
  const off = flat(buildSystemPrompt(["FEATURED"], "off", "single"));

  console.log("threshold:");
  // Anchored to the model's own MATCH_WINNER median (80) over 464 post-fix rows.
  check("is 80", HEDGE_CONFIDENCE_REVIEW_THRESHOLD === 80, String(HEDGE_CONFIDENCE_REVIEW_THRESHOLD));

  console.log("\nthe rule reaches both calibration modes:");
  const marker = "CONFIDENCE IS A SECOND, INDEPENDENT TEST FOR THE STRAIGHT WINNER";
  check("present in margin mode", margin.includes(marker));
  check("present in tiered mode", tiered.includes(marker));
  // "off" carries no market-risk steering at all, and this is market-risk steering.
  check("absent in off mode", !off.includes(marker));
  check("the threshold is stated as a number, not prose",
    margin.includes(String(HEDGE_CONFIDENCE_REVIEW_THRESHOLD)));

  console.log("\nboth branches are offered, so it cannot read as 'always switch':");
  check("branch 1 — switch to MATCH_WINNER", /switch to\s+MATCH_WINNER/.test(margin));
  check("branch 2 — keep the hedge and lower the number", /KEEP the hedge and LOWER the confidence/.test(margin));
  check("it overrides the band gate explicitly", /NOT an\s+EXTREME MISMATCH by margin/.test(margin));

  console.log("\nthe two failure modes the ticket warned about are named:");
  check("not a mechanical conversion", /is\s+not a\s+MATCH_WINNER at 84/.test(margin));
  check("not a quota", /it is not a quota/i.test(margin));
  check("says lowering the number can be the correct outcome",
    /lowering the number is the correct outcome/i.test(margin));

  console.log("\nit did not displace the existing calibration:");
  check("EXTREME band still present", margin.includes("EXTREME MISMATCH"));
  check("hedge failure-mode menu from b55589f still present", margin.includes("PRIMARY failure mode"));
  check("certainty prohibition still appended", /guarantee/i.test(margin));

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
