/**
 * What a fixture is, from the provider status code, a stored score and the
 * clock. Pure and dependency-light (only src/lib/matchStatus.ts) so client
 * components can use it without pulling in the Match Centre statistics.
 * Re-exported from src/lib/matchCentre.ts, which is where it was introduced
 * in Sprint 02; there is one implementation.
 */
import { classifyStatus, isIrregular } from "@/lib/matchStatus";

export type MatchState = "scheduled" | "live" | "finished" | "postponed" | "cancelled" | "abandoned" | "awarded" | "suspended" | "unknown";

const IRREGULAR_STATE: Record<string, MatchState> = { PST: "postponed", CANC: "cancelled", ABD: "abandoned", AWD: "awarded", WO: "awarded", SUSP: "suspended", INT: "suspended" };

/**
 * What the page may say about the fixture. A provider status code, when we
 * hold one, decides it — a stored final score alone never makes a postponed
 * or abandoned fixture "finished". Without a code, a settled final score
 * means finished, a future kickoff means scheduled, and a past kickoff with
 * nothing else is "unknown" rather than a guess at live.
 */
export function matchState(input: { statusShort?: string | null; finalScore?: { home: number; away: number } | null; kickoff: Date; now?: Date }): MatchState {
  const code = input.statusShort ?? null;
  if (code) {
    if (IRREGULAR_STATE[code]) return IRREGULAR_STATE[code];
    if (isIrregular(code)) return "cancelled";
    const group = classifyStatus(code);
    if (group === "live") return "live";
    if (group === "upcoming") return (input.now ?? new Date()) < input.kickoff ? "scheduled" : "unknown";
    return "finished";
  }
  if (input.finalScore) return "finished";
  return (input.now ?? new Date()) < input.kickoff ? "scheduled" : "unknown";
}

export const MATCH_STATE_LABEL: Record<MatchState, string> = {
  scheduled: "Scheduled",
  live: "In play",
  finished: "Full time",
  postponed: "Postponed",
  cancelled: "Cancelled",
  abandoned: "Abandoned",
  awarded: "Result awarded",
  suspended: "Suspended",
  unknown: "Result pending",
};

