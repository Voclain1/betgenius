/**
 * All three enforcement layers for prohibited certainty language.
 *
 *   (a) the prompt carries the prohibition,
 *   (b) the deterministic scan REJECTS a violating draft,
 *   (c) the badge, explanation and promotional copy are themselves clean.
 *
 * Layer (c) is static file scanning rather than rendering, because the failure
 * it guards against is someone writing "guaranteed winners" into marketing copy
 * months from now — a check that only ran against today's rendered output would
 * not catch the file it was added to.
 *
 * Run: npx tsx scripts/check-certainty-language.ts
 */
export {};

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  PROHIBITED_CERTAINTY_TERMS,
  findCertaintyViolations,
  scanDraftForCertainty,
  certaintyProhibitionBlock,
} from "../src/lib/certaintyLanguage";
import { buildSystemPrompt } from "../src/lib/ai/analysis";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("layer (a) — the prompt:");
const block = certaintyProhibitionBlock();
check("the prohibition block names the rule", block.includes("NO CERTAINTY LANGUAGE"));
check("it is generated from the same list the scan uses", PROHIBITED_CERTAINTY_TERMS.every((t) => block.includes(t.label)));
check("it explains the claim, not just the vocabulary", block.includes("about the CLAIM"));
// Every mode, including the "off" comparison prompt: the ban is not a feature
// of one calibration.
for (const mode of ["off", "tiered", "margin"] as const) {
  check(`${mode} calibration still carries the prohibition`, buildSystemPrompt(["VIP"], mode).includes("NO CERTAINTY LANGUAGE"));
}
for (const breadth of ["single", "multi"] as const) {
  check(`${breadth} breadth still carries the prohibition`, buildSystemPrompt(["VIP"], "margin", breadth).includes("NO CERTAINTY LANGUAGE"));
}

console.log("\nlayer (b) — the deterministic scan:");
const VIOLATING = [
  "This is a guaranteed win for the home side.",
  "Sporting are a sure thing here.",
  "They simply can't lose this one.",
  "A nailed-on victory.",
  "This is risk-free at the price.",
  "We are 100% behind the favourite.",
  "An absolute lock.",
  "A dead cert given the form.",
  "This is free money.",
  "Porto are unbeatable at home.",
  "It is impossible to lose from here.",
  "Zero risk on this selection.",
];
for (const text of VIOLATING) {
  check(`rejects: "${text.slice(0, 42)}"`, findCertaintyViolations(text, "reasoning").length > 0);
}

// The bar is inevitability, not confidence. These must all survive, or the
// scan would quietly forbid honest analysis.
const ALLOWED = [
  "Porto are clear favourites and should win comfortably.",
  "The home side are strong, with the better squad and recent form.",
  "A confident pick, though Arouca have kept two clean sheets.",
  "The match is locked in a tight midfield battle.",
  "Surely the away side will press higher after the break.",
  "There is pressure on the manager after three defeats.",
  "Sure, the away record is poor, but the h2h is close.",
  "Their defence looks certain to be missing two starters.",
];
for (const text of ALLOWED) {
  const v = findCertaintyViolations(text, "reasoning");
  check(`allows: "${text.slice(0, 42)}"`, v.length === 0, v.map((x) => x.label).join(","));
}

console.log("\nlayer (b) — every field is scanned, not just reasoning:");
check("a violation in the preview is caught", scanDraftForCertainty({ matchPreview: "A guaranteed result." }).length > 0);
check("a violation in a key factor is caught", scanDraftForCertainty({ keyFactors: ["Form", "This cannot lose"] }).length > 0);
check("a clean draft passes", scanDraftForCertainty({ reasoning: "Strong favourites at home.", matchPreview: "A likely home win.", keyFactors: ["Good form"] }).length === 0);
check("the violation names its field", scanDraftForCertainty({ keyFactors: ["risk-free"] })[0]?.field === "keyFactors[0]");

console.log("\nlayer (c) — shipped copy is itself clean:");
const COPY_FILES = [
  "src/components/MarketConfirmedBadge.tsx",
  "src/components/PredictionCard.tsx",
  "src/app/(public)/pricing/page.tsx",
  "src/app/(public)/page.tsx",
  "src/lib/marketConfirmed.ts",
];
for (const rel of COPY_FILES) {
  const path = join(process.cwd(), rel);
  if (!existsSync(path)) {
    console.log(`  SKIP  ${rel} (not present)`);
    continue;
  }
  const text = readFileSync(path, "utf8");
  // The prohibition list itself and the scanner's own fixtures legitimately
  // contain these strings; only files that RENDER copy are scanned.
  const v = findCertaintyViolations(text, rel);
  check(`${rel} contains no certainty language`, v.length === 0, v.map((x) => `${x.label}:"${x.match}"`).join(", "));
}

console.log("\nbadge copy says what the badge actually means:");
const badge = readFileSync(join(process.cwd(), "src/components/MarketConfirmedBadge.tsx"), "utf8");
check("it states the pick can lose", /can lose/i.test(badge));
check("it states it is not a guarantee", /not a guarantee/i.test(badge));
check("it shows both model and market", badge.includes("Model ") && badge.includes("Market "));
check("it explains the de-vig in plain words", /margin/i.test(badge) && /more than 100%/i.test(badge));
// No shields, locks, checkmarks or certainty-green.
for (const forbidden of ["Shield", "ShieldCheck", "Lock", "BadgeCheck", "CheckCircle", "text-emerald", "bg-emerald", "text-green", "bg-green"]) {
  check(`badge avoids "${forbidden}" styling`, !badge.includes(forbidden));
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
if (failures) process.exitCode = 1;
