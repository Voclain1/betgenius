/**
 * The publication gate for reader-facing prose, shared by every path that
 * produces it.
 *
 * First-pass generation (src/lib/ai/generate.ts) has rejected drafts with
 * certainty language or leaked house terminology for a long time. The two
 * private rewrite paths did not: the pending-review rewrite
 * (src/lib/ai/rewrite.ts) and the Prediction Updates evidence rewrite
 * (/api/admin/reassessment/rewrite). A rewrite is where a reviewer's note
 * ("the h2h is weak") is most likely to be echoed back as "As the reviewer
 * noted, the head-to-head is weak", so it needs the gate most.
 *
 * Rejects rather than edits, like the scans it combines.
 */
import { scanDraftForCertainty } from "@/lib/certaintyLanguage";
import { scanDraftForInternalTerminology } from "@/lib/houseVoice";

export type ProseViolation = { field: string; label: string; match: string; kind: "certainty" | "house-voice" };

export function proseViolations(draft: {
  matchPreview?: string | null;
  keyFactors?: string[] | null;
  reasoning?: string | null;
}): ProseViolation[] {
  return [
    ...scanDraftForCertainty(draft).map((v) => ({ field: v.field, label: v.label, match: v.match, kind: "certainty" as const })),
    ...scanDraftForInternalTerminology(draft).map((v) => ({ ...v, kind: "house-voice" as const })),
  ];
}

/** One line for an administrator: which wording, in which field. Never published. */
export function describeProseViolations(violations: ProseViolation[]): string {
  return [...new Set(violations.map((v) => `"${v.match}" (${v.field})`))].slice(0, 4).join(", ");
}
