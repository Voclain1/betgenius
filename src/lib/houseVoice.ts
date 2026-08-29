/**
 * Internal terminology that must never reach the reader.
 *
 * Same three-consumer shape as certaintyLanguage.ts, for the same reason —
 * one list feeding (a) the generation prompt, (b) a deterministic scan that
 * rejects a draft before it can reach PENDING_REVIEW, and (c) static tests —
 * so the three cannot drift apart.
 *
 * The leak this exists to stop, found in real published output:
 *
 *   "In line with the Genius tier risk calibration for cup knockout fixtures
 *    with limited sample data, backing Os Limianos with the double chance
 *    hedge..."
 *
 * The reader has no idea what a "Genius tier risk calibration" is. It is the
 * name of an instruction WE gave the model, echoed back as though it were a
 * fact about the football. Every such sentence spends the reader's attention
 * explaining our pipeline to them instead of the match.
 *
 * Like the certainty scan, this REJECTS rather than edits. Deleting "under
 * GENIUS calibration" from a sentence leaves a clause that was built around
 * it — the prose still reads as though it is justifying a house rule, minus
 * the words that made that visible to a reviewer.
 *
 * FALSE POSITIVES ARE THE REAL RISK HERE, more than in the certainty list,
 * because several of these words have ordinary football meanings:
 *
 *   - "tier" is banned only when OUR tier names precede it. "Second-tier
 *     football" and "a tier below the champions" are normal writing.
 *   - "system" is not banned at all. "The system Arteta plays" is football.
 *   - "premium" alone is not banned — "a premium finisher" is a compliment.
 *     Only "Premium tier"/"Premium calibration" style usage is.
 *   - "genius" alone is not banned — "a moment of genius" is football writing.
 */

export type ProhibitedTerm = {
  /** Matched case-insensitively against whole words. */
  pattern: RegExp;
  /** What it is, for the rejection message and the test output. */
  label: string;
};

export const PROHIBITED_INTERNAL_TERMS: ProhibitedTerm[] = [
  // "Calibration" has no football meaning in this context. Every occurrence
  // found in real output was the model narrating its own instructions.
  { pattern: /\bcalibrations?\b/i, label: "calibration" },
  { pattern: /\brisk[-\s]calibrated\b/i, label: "risk-calibrated" },

  // Tier names used as system concepts rather than as prose.
  // Regex LITERALS, not new RegExp(`...`). As template strings these read \b as
  // the backspace control character instead of a word boundary, so all three
  // matched nothing and the "calibration" rule below was silently carrying the
  // entire list. checkPatternsAreWordBoundaryRegexes() in the test guards this.
  { pattern: /\b(genius|vip|premium|banker|featured)\s+(tier|calibration|band|category|mode|guidelines?)\b/i, label: "Genius/VIP tier as a system concept" },
  { pattern: /\bunder\s+(the\s+)?(genius|vip|premium|banker|featured)\b/i, label: "under the <tier>" },
  { pattern: /\bin\s+(line|accordance)\s+with\s+(the\s+)?(genius|vip|premium|banker|featured|risk)\b/i, label: "in line with the <tier>/risk" },

  // Mechanics of how a pick is produced.
  { pattern: /\bconfidence\s+(band|threshold|mechanic)\b/i, label: "confidence band/threshold" },
  { pattern: /\brisk\s+(profile|management|moderation|mitigation|posture)\b/i, label: "risk profile/management" },
  { pattern: /\b(safety|risk)\s+calibrations?\b/i, label: "safety calibrations" },
  { pattern: /\bmarket\s+breadth\b/i, label: "market breadth" },
  { pattern: /\bhedg(e|ing)\s+(guidelines?|rules?|policy)\b/i, label: "hedging guidelines" },
  { pattern: /\bper\s+(the\s+)?(guidelines?|instructions?|rules?|brief)\b/i, label: "per the guidelines" },
  { pattern: /\bas\s+(instructed|specified|directed)\b/i, label: "as instructed" },

  // The machinery itself. "system" is deliberately absent — see the header.
  { pattern: /\b(our|the|this)\s+(algorithm|pipeline|prompt|generator)\b/i, label: "our algorithm/pipeline/prompt" },
  { pattern: /\bpending[_\s]review\b/i, label: "PENDING_REVIEW" },
  { pattern: /\bmarket[_\s]type\b/i, label: "marketType" },
  { pattern: /\bselection\s+schema\b/i, label: "selection schema" },
];

export type InternalTerminologyViolation = {
  field: string;
  label: string;
  match: string;
};

/** Every prohibited term present in one field, with the text that matched. */
export function findInternalTerminologyViolations(
  text: string | null | undefined,
  field: string,
): InternalTerminologyViolation[] {
  if (!text) return [];
  const violations: InternalTerminologyViolation[] = [];
  for (const term of PROHIBITED_INTERNAL_TERMS) {
    const found = text.match(term.pattern);
    if (found) violations.push({ field, label: term.label, match: found[0] });
  }
  return violations;
}

/** Scan every reader-facing field of a draft. */
export function scanDraftForInternalTerminology(draft: {
  matchPreview?: string | null;
  keyFactors?: string[] | null;
  reasoning?: string | null;
}): InternalTerminologyViolation[] {
  return [
    ...findInternalTerminologyViolations(draft.matchPreview, "matchPreview"),
    ...findInternalTerminologyViolations((draft.keyFactors ?? []).join("\n"), "keyFactors"),
    ...findInternalTerminologyViolations(draft.reasoning, "reasoning"),
  ];
}

/** The prompt section, generated from the list above so the two agree. */
export function internalTerminologyProhibitionBlock(): string {
  return `

WRITE FOR A READER WHO CANNOT SEE THESE INSTRUCTIONS.
The reasoning is football analysis. It must never describe how the pick was
produced, or name any concept from these instructions. Never write phrases like:
${PROHIBITED_INTERNAL_TERMS.map((t) => `  - ${t.label}`).join("\n")}
Do not say a pick follows a rule, tier, calibration, guideline or instruction.
Do not name the category a pick belongs to. Justify the pick ONLY with evidence
about these teams: form, goals, head-to-head, table position, absences, venue.

BAD:  "In line with the Genius tier risk calibration, backing the double chance
       hedge provides coverage."
GOOD: "Sarajevo have kept clean sheets in both league games and scored once;
       their last ten meetings with Zrinjski produced under 2.5 goals eight
       times."`;
}
