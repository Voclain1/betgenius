import type { H2HMeeting } from "@/lib/h2h";

/**
 * An H2H record needs more than one or two isolated meetings before it becomes
 * a useful search landing page. This deliberately matches the minimum used by
 * match-page evidence scoring, so the same history is not treated as strong on
 * one template and substantive on another.
 */
export const MIN_H2H_INDEX_MEETINGS = 3;

export function isSubstantiveH2H(meetings: H2HMeeting[]): boolean {
  return meetings.length >= MIN_H2H_INDEX_MEETINGS;
}
