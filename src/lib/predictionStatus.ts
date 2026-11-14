/**
 * What a prediction row may say about its match (Sprint 03).
 *
 * Presentation only. This reads signals that already exist — a provider status
 * code captured by the Sprint 02 result record, a stored final score, the
 * kickoff time — and turns them into one word a reader can trust. It changes
 * no status calculation, no settlement and no ranking: `matchState` (Sprint
 * 02) and `src/lib/matchStatus.ts` still decide what each provider code means.
 *
 * Pure: no database, no network, no React — and it imports neither the
 * generation, settlement nor odds modules. scripts/check-prediction-experience.ts
 * asserts that boundary.
 *
 * THE RULES, each of which exists because the naive version misleads:
 *
 * - A feed row used to say nothing but its kickoff time. A postponed match, a
 *   match that had kicked off hours ago and one still to come therefore looked
 *   identical. Now a started or finished-but-unsettled match says so.
 * - Only TERMINAL provider codes are trusted from a cache: finished (FT, AET,
 *   PEN) and irregular (PST, CANC, ABD, AWD, WO, SUSP, INT). A cached live code
 *   ("2H") was true when it was captured and is false by the time it is read,
 *   so it is ignored; live data comes from the existing live-score poll.
 * - Without a status code the label comes from the clock alone and claims only
 *   what the clock proves: "Kicked off" inside the in-play window, "Awaiting
 *   result" after it. Never "Live" — that needs live data.
 * - A provider status beats a stored score (a postponed or abandoned match is
 *   never "full time"), matching matchState in src/lib/matchCentre.ts.
 * - Missing information is not zero: no kickoff, no label, no claim.
 */
import { matchState, type MatchState } from "@/lib/matchState";
import { isIrregular } from "@/lib/matchStatus";

/**
 * How long after kickoff a match may still be in play. Equal to LIVE_WINDOW_MS
 * in src/components/LiveScores.tsx (asserted by the checks), which is a client
 * module and therefore not imported here.
 */
export const IN_PLAY_WINDOW_MS = 150 * 60_000;

export type RowStatusKind =
  | "upcoming"
  | "started"
  | "awaiting"
  | "final"
  | "void"
  | "postponed"
  | "cancelled"
  | "abandoned"
  | "suspended"
  | "awarded";

export type RowStatus = {
  kind: RowStatusKind;
  /** The words to print; null means "say nothing" (an ordinary upcoming match, or nothing is known). */
  label: string | null;
  /** warn: the match did not go ahead as scheduled. muted: factual and quiet. */
  tone: "muted" | "warn";
  /** True when no match result will exist (postponed, cancelled, abandoned, suspended). */
  unplayed: boolean;
};

const FINISHED_CODES: ReadonlySet<string> = new Set(["FT", "AET", "PEN"]);
const SUSPENDED_CODES: ReadonlySet<string> = new Set(["SUSP", "INT"]);

/** A cached code is only believed when it names an end state. */
export function trustedStatusCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return FINISHED_CODES.has(code) || SUSPENDED_CODES.has(code) || isIrregular(code) ? code : null;
}

const LABELS: Record<RowStatusKind, string | null> = {
  upcoming: null,
  started: "Kicked off",
  awaiting: "Awaiting result",
  final: "FT",
  void: "Void",
  postponed: "Postponed",
  cancelled: "Cancelled",
  abandoned: "Abandoned",
  suspended: "Suspended",
  awarded: "Result awarded",
};

const IRREGULAR: Partial<Record<MatchState, RowStatusKind>> = {
  postponed: "postponed",
  cancelled: "cancelled",
  abandoned: "abandoned",
  suspended: "suspended",
  awarded: "awarded",
};

function build(kind: RowStatusKind): RowStatus {
  const warn = kind === "postponed" || kind === "cancelled" || kind === "abandoned" || kind === "suspended" || kind === "awarded";
  return { kind, label: LABELS[kind], tone: warn ? "warn" : "muted", unplayed: kind === "postponed" || kind === "cancelled" || kind === "abandoned" || kind === "suspended" };
}

export function rowStatus(input: {
  /** Provider status short code from the captured result record, when one exists. */
  statusCode?: string | null;
  kickoff?: Date | string | null;
  outcome?: string | null;
  finalScore?: { home: number; away: number } | null;
  now?: Date;
}): RowStatus {
  const now = input.now ?? new Date();
  const code = trustedStatusCode(input.statusCode);
  const kickoff = input.kickoff ? new Date(input.kickoff) : null;
  const hasKickoff = !!kickoff && Number.isFinite(kickoff.getTime());

  // A provider end-state decides first; it overrides a stored score.
  if (code) {
    const state = matchState({ statusShort: code, finalScore: input.finalScore ?? null, kickoff: hasKickoff ? kickoff! : now, now });
    const irregular = IRREGULAR[state];
    if (irregular) return build(irregular);
    if (state === "finished") return build("final");
  }

  if (input.finalScore) return build("final");
  if (input.outcome === "VOID") return build("void");
  if (input.outcome === "WON" || input.outcome === "LOST") return build("final");

  if (!hasKickoff) return build("upcoming");
  const elapsed = now.getTime() - kickoff!.getTime();
  if (elapsed < 0) return build("upcoming");
  return build(elapsed <= IN_PLAY_WINDOW_MS ? "started" : "awaiting");
}

/** Kickoff phase from the clock alone — used where no row is available (the match header). */
export function clockPhase(kickoff: Date | string | null | undefined, now: Date = new Date()): "upcoming" | "started" | "awaiting" | "unknown" {
  if (!kickoff) return "unknown";
  const t = new Date(kickoff).getTime();
  if (!Number.isFinite(t)) return "unknown";
  const elapsed = now.getTime() - t;
  return elapsed < 0 ? "upcoming" : elapsed <= IN_PLAY_WINDOW_MS ? "started" : "awaiting";
}
