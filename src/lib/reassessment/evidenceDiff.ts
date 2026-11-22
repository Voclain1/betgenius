/**
 * Pure helpers for the admin Prediction Updates workspace (issue #232).
 *
 * Compares the evidence a prediction was WRITTEN from (its generation
 * snapshot) with the latest monitoring snapshot, turns monitoring signals
 * into plain reasons, finds statements that may now be out of date, and
 * decides when an explanation-only update is NOT allowed because the new
 * evidence undermines the pick. No I/O; unit-checked.
 */
import type { MatchDigest, TeamDigest } from "@/lib/ai/digest";

export type Signal = { code: string; severity: "MODERATE" | "CRITICAL" | string; source: string; message: string };

type Record_ = { played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number } | null;
export type TeamDiff = {
  side: "home" | "away";
  team: string;
  newResults: Array<{ date: string; opponent: string; venue: string; result: string; score: string | null; competition: string | null }>;
  form: { before: string | null; after: string | null } | null;
  season: { before: Record_; after: Record_ } | null;
  rank: { before: number | null; after: number | null } | null;
  newlyUnavailable: string[];
  noLongerListed: string[];
  coach: { before: string; after: string } | null;
};
export type EvidenceDiff = {
  teams: TeamDiff[];
  newHeadToHead: number;
  changed: boolean;
};

const rec = (t: TeamDigest | undefined | null): Record_ => {
  const o = t?.overall as { played?: number; win?: number; draw?: number; loss?: number; goalsFor?: number; goalsAgainst?: number } | null | undefined;
  return o && typeof o.played === "number"
    ? { played: o.played, won: o.win ?? 0, drawn: o.draw ?? 0, lost: o.loss ?? 0, goalsFor: o.goalsFor ?? 0, goalsAgainst: o.goalsAgainst ?? 0 }
    : null;
};
const norm = (s: string) => s.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");

export function diffEvidence(original: MatchDigest | null, latest: MatchDigest | null): EvidenceDiff | null {
  if (!original || !latest) return null;
  const teams: TeamDiff[] = [];
  for (const side of ["home", "away"] as const) {
    const a = original.teams?.[side], b = latest.teams?.[side];
    if (!a || !b) continue;
    const lastSeen = (a.last5 ?? []).map((m) => m.date).sort().at(-1) ?? "";
    const newResults = (b.last5 ?? []).filter((m) => m.date > lastSeen)
      .sort((x, y) => x.date.localeCompare(y.date))
      .map((m) => ({ date: m.date.slice(0, 10), opponent: m.opponent, venue: m.venue, result: m.result,
        score: m.goalsFor != null && m.goalsAgainst != null ? `${m.goalsFor}-${m.goalsAgainst}` : null, competition: m.competition ?? null }));
    const before = new Set((a.availability ?? []).map((p) => norm(p.player)));
    const after = new Set((b.availability ?? []).map((p) => norm(p.player)));
    const ra = rec(a), rb = rec(b);
    const d: TeamDiff = {
      side, team: b.name ?? a.name ?? side,
      newResults,
      form: (a.form ?? null) !== (b.form ?? null) ? { before: a.form ?? null, after: b.form ?? null } : null,
      season: JSON.stringify(ra) !== JSON.stringify(rb) ? { before: ra, after: rb } : null,
      rank: (a.rank ?? null) !== (b.rank ?? null) && (a.rank != null || b.rank != null) ? { before: a.rank ?? null, after: b.rank ?? null } : null,
      newlyUnavailable: (b.availability ?? []).filter((p) => !before.has(norm(p.player))).map((p) => `${p.player} (${p.kind})`),
      noLongerListed: (a.availability ?? []).filter((p) => !after.has(norm(p.player))).map((p) => p.player),
      coach: a.coach?.name && b.coach?.name && norm(a.coach.name) !== norm(b.coach.name) ? { before: a.coach.name, after: b.coach.name } : null,
    };
    teams.push(d);
  }
  const newHeadToHead = Math.max(0, (latest.h2h?.meetings?.length ?? 0) - (original.h2h?.meetings?.length ?? 0));
  const changed = newHeadToHead > 0 || teams.some((t) => t.newResults.length || t.form || t.season || t.rank || t.newlyUnavailable.length || t.noLongerListed.length || t.coach);
  return { teams, newHeadToHead, changed };
}

/** Plain-language reason for a monitoring signal code. */
export function friendlyReason(code: string): string {
  if (/^fixture-status-PST/.test(code)) return "Fixture postponed";
  if (/^fixture-status-CANC/.test(code)) return "Fixture cancelled";
  if (/^fixture-status-ABD/.test(code)) return "Fixture abandoned";
  if (/^fixture-status-(AWD|WO)/.test(code)) return "Result awarded without play";
  if (/^fixture-status-SUSP/.test(code)) return "Fixture suspended";
  if (/^fixture-kickoff-shift/.test(code)) return "Kickoff time changed";
  if (/^new-result-/.test(code)) return "A new match result is available";
  if (/^new-unavailable-/.test(code)) return "New injury or suspension reported";
  if (/^coach-change/.test(code)) return "Head coach changed";
  if (/^confirmed-lineup/.test(code)) return "Official lineup: a key player is not starting";
  if (/^market-movement/.test(code)) return "Bookmaker price moved significantly";
  if (/^early-odds-floor-crossing/.test(code)) return "Price fell below the free-tip minimum";
  return "Evidence changed";
}

/** Sentences in the published text that refer to something the new evidence changed. Heuristic: "may be out of date", never "wrong". */
export function possiblyStaleStatements(text: string, diff: EvidenceDiff | null, signals: Signal[]): string[] {
  if (!text) return [];
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const hits = new Set<string>();
  const formWords = /\b(form|last \w+ (?:matches|games|outings)|unbeaten|winless|won|lost|drew|streak|run of|results?)\b/i;
  const tableWords = /\b(table|position|place|top|bottom|points|rank(?:ed)?|\d+(?:st|nd|rd|th))\b/i;
  const squadWords = /\b(injur\w*|suspend\w*|absen\w*|missing|without|available|fit|return\w*|lineup|starting|xi)\b/i;
  const coachWords = /\b(coach|manager|boss|head coach)\b/i;
  for (const t of diff?.teams ?? []) {
    const name = new RegExp(t.team.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").split(/\s+/)[0], "i");
    for (const s of sentences) {
      if (!name.test(s)) continue;
      if ((t.newResults.length || t.form) && formWords.test(s)) hits.add(s);
      if ((t.rank || t.season) && tableWords.test(s)) hits.add(s);
      if ((t.newlyUnavailable.length || t.noLongerListed.length) && squadWords.test(s)) hits.add(s);
      if (t.coach && coachWords.test(s)) hits.add(s);
    }
  }
  if (signals.some((x) => /^fixture-kickoff-shift|^fixture-status-/.test(x.code)))
    for (const s of sentences) if (/\b(kick-?off|tonight|this (?:evening|afternoon|weekend)|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(s)) hits.add(s);
  return [...hits];
}

/** A confidence drop larger than this in a proposed rewrite is a decision, not prose. */
export const DECISION_CONFIDENCE_DROP = 5;

/**
 * Whether the new evidence undermines the pick, so an explanation-only update
 * must NOT be applied (it would mask the change behind reassuring prose).
 * Then only Keep / Withdraw / qualified Replacement are offered.
 */
export function decisionRequired(input: {
  signals: Signal[];
  originalConfidence: number;
  draft?: { sameSelection: boolean; confidence: number } | null;
}): { required: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const s of input.signals) if (s.severity === "CRITICAL") reasons.push(friendlyReason(s.code) + " (critical)");
  if (input.draft && !input.draft.sameSelection) reasons.push("The updated analysis points to a different selection");
  if (input.draft && input.draft.confidence < input.originalConfidence - DECISION_CONFIDENCE_DROP)
    reasons.push(`The updated analysis supports lower confidence (${input.draft.confidence}% vs ${input.originalConfidence}%)`);
  return { required: reasons.length > 0, reasons: [...new Set(reasons)] };
}

export type AdminStatus =
  | "Match started (read-only)" | "Awaiting your decision" | "Draft ready" | "New evidence"
  | "Needs more evidence" | "Retained" | "Updated by admin" | "Withdrawn" | "Current";

export function adminStatus(input: {
  kickoffPassed: boolean;
  reassessmentStatus: string | null;
  latestDecisionKind: string | null;
  draftReady: boolean;
  decisionRequired: boolean;
}): AdminStatus {
  if (input.kickoffPassed) return "Match started (read-only)";
  if (input.reassessmentStatus === "REVIEW_REQUIRED") {
    if (input.decisionRequired) return "Awaiting your decision";
    return input.draftReady ? "Draft ready" : "New evidence";
  }
  if (input.reassessmentStatus === "UNKNOWN") return "Needs more evidence";
  if (input.latestDecisionKind === "ADMIN_REWRITE_APPLIED") return "Updated by admin";
  if (input.latestDecisionKind === "WITHDRAWN" || input.reassessmentStatus === "WITHDRAWN") return "Withdrawn";
  if (input.latestDecisionKind === "CONFIRMED" || input.latestDecisionKind === "EVIDENCE_REVIEW_RETAINED") return "Retained";
  return "Current";
}

/** Prefilled, editable audit note from the verified signals. */
export function suggestedAuditNote(signals: Signal[], kind: "update" | "keep"): string {
  const reasons = [...new Set(signals.map((s) => friendlyReason(s.code)))].join("; ") || "Evidence reviewed";
  return kind === "update"
    ? `Explanation updated after new evidence: ${reasons}. Selection, confidence and odds unchanged.`
    : `Reviewed new evidence (${reasons}); original analysis retained.`;
}
