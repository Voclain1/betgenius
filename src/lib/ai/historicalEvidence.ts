/**
 * Historical evidence classification for already-generated predictions.
 *
 * WHY. `contextComplete=false` drove a single admin warning — "Generated with
 * no live data" — that meant two different things: genuinely missing football
 * evidence, and (for the cache-only early lane) evidence that existed but was
 * past a freshness floor. PR #226 split the detail-page banner into four
 * states from the saved snapshot. This module completes that work for every
 * historical row and every admin surface, and adds the checks the saved
 * snapshot alone cannot make: how old the evidence was when the pick was
 * written, and whether a match the team had already played was missing.
 *
 * RULES.
 *  - Never "verified" merely because cached data exists. EVIDENCE_AVAILABLE
 *    needs both sides' sporting evidence, recent results for both, nothing
 *    older than the recency bound at generation, no known match missed at
 *    generation, and either fresh provenance (jobs since 22 Nov 2026) or a
 *    historical completeness flag that was true.
 *  - Never "inaccurate" merely because of an old flag: FRESHNESS_UNCERTAIN is
 *    a request to verify, not a verdict.
 *  - Read-only. Classification is computed on read from the immutable
 *    AIJob.context snapshot, kickoffs we already captured and current team
 *    caches. No prediction, job or flag is written; no provider call is made.
 */
import type { MatchDigest, TeamDigest } from "@/lib/ai/digest";
import { hasSubstantiveFootballEvidence } from "@/lib/ai/evidenceReadiness";
import {
  assessSupersession,
  latestObservedMatch,
  PLAYED_AFTER_KICKOFF_MS,
  type EvidenceProvenance,
  type KnownKickoff,
} from "@/lib/ai/evidenceFreshness";

export type HistoricalEvidenceClass =
  | "EVIDENCE_AVAILABLE"
  | "FRESHNESS_UNCERTAIN"
  | "EVIDENCE_INSUFFICIENT"
  | "SNAPSHOT_UNAVAILABLE"
  /** Admin-authored or imported rows: never generated, so no evidence disclaimer applies. */
  | "NOT_GENERATED";

export const FLAGGED_CLASSES: readonly HistoricalEvidenceClass[] = ["FRESHNESS_UNCERTAIN", "EVIDENCE_INSUFFICIENT", "SNAPSHOT_UNAVAILABLE"];

/** A team's latest recorded match older than this at generation is not treated as current form. */
export const RECENCY_BOUND_DAYS = 21;

export type EvidenceReason = { code: string; detail: string };

export type SideIndicators = {
  recentMatches: number;
  seasonStats: boolean;
  latestMatch: string | null;
  /** Days between the latest recorded match and generation. */
  latestMatchAgeDays: number | null;
};

export type HistoricalEvidence = {
  classification: HistoricalEvidenceClass;
  reasons: EvidenceReason[];
  indicators: {
    generatedAt: string | null;
    contextCompleteFlag: boolean;
    home: SideIndicators;
    away: SideIndicators;
    h2hMeetings: number;
    standingsRowsForFixture: number;
    provenance: Record<string, string> | null;
    /** Whether matches missed at generation could be checked (captured kickoffs exist only from 19 Nov 2026). */
    supersessionCheckable: boolean;
  };
};

const DAY = 86_400_000;
/** UpcomingFixture capture began on 19 Nov 2026 (PR #209). Earlier generations cannot be checked for missed matches. */
export const KICKOFF_CAPTURE_STARTED = new Date("2026-11-19T00:00:00Z");

const PROVENANCE_LABEL: Record<string, string> = { homeTeam: "home team", awayTeam: "away team", standings: "standings", h2h: "head-to-head" };

function side(team: TeamDigest | null | undefined, generatedAt: Date | null): SideIndicators {
  const latest = latestObservedMatch(team);
  return {
    recentMatches: team?.last5?.length ?? 0,
    seasonStats: !!team?.overall,
    latestMatch: latest?.toISOString() ?? null,
    latestMatchAgeDays: latest && generatedAt ? Math.round(((generatedAt.getTime() - latest.getTime()) / DAY) * 10) / 10 : null,
  };
}

/**
 * Pure classification. `known` = captured kickoffs for the two teams, with
 * `confirmedPlayed` already resolved against current team caches (see
 * confirmFromTeamCaches); pass [] when none are available.
 */
export function classifyHistoricalEvidence(input: {
  hasAiJob: boolean;
  digest: MatchDigest | null;
  provenance: EvidenceProvenance | null;
  contextComplete: boolean;
  generatedAt: Date | null;
  known: readonly KnownKickoff[];
}): HistoricalEvidence {
  const { digest, provenance, contextComplete, generatedAt } = input;
  const reasons: EvidenceReason[] = [];
  const home = digest?.teams?.home;
  const away = digest?.teams?.away;
  const supersessionCheckable = !!generatedAt && generatedAt >= KICKOFF_CAPTURE_STARTED;
  const indicators: HistoricalEvidence["indicators"] = {
    generatedAt: generatedAt?.toISOString() ?? null,
    contextCompleteFlag: contextComplete,
    home: side(home, generatedAt),
    away: side(away, generatedAt),
    h2hMeetings: digest?.h2h?.meetings?.length ?? 0,
    standingsRowsForFixture: digest?.standings?.neighbourhood?.filter((r) => r.isFixtureTeam && r.played > 0).length ?? 0,
    provenance: provenance
      ? Object.fromEntries((["homeTeam", "awayTeam", "standings", "h2h"] as const).map((k) => [k, provenance[k].status]))
      : null,
    supersessionCheckable,
  };
  const out = (classification: HistoricalEvidenceClass): HistoricalEvidence => ({ classification, reasons, indicators });

  if (!input.hasAiJob) {
    reasons.push({ code: "not-generated", detail: "Created or edited by an administrator; not produced by generation." });
    return out("NOT_GENERATED");
  }
  if (!digest) {
    reasons.push({ code: "no-saved-snapshot", detail: "No readable evidence snapshot was saved with this generation (older format or missing). The evidence cannot be reconstructed." });
    return out("SNAPSHOT_UNAVAILABLE");
  }

  // ---- Insufficient: meaningful sporting evidence missing.
  if (!hasSubstantiveFootballEvidence(digest)) {
    reasons.push({ code: "no-sporting-evidence", detail: "No recent results, season statistics, played table rows or head-to-head meetings were saved for either team." });
    return out("EVIDENCE_INSUFFICIENT");
  }
  for (const [label, s] of [["home", indicators.home], ["away", indicators.away]] as const) {
    if (s.recentMatches === 0 && !s.seasonStats) {
      reasons.push({ code: `${label}-no-evidence`, detail: `No recent results or season statistics were saved for the ${label} team; any statements about it are unsupported by the saved evidence.` });
    }
  }
  if (reasons.length) return out("EVIDENCE_INSUFFICIENT");

  // ---- Freshness: real evidence; is it verifiably current for when it was written?
  if (!generatedAt) reasons.push({ code: "generation-time-unknown", detail: "The generation time is not recorded, so evidence age cannot be checked." });
  for (const [label, s] of [["home", indicators.home], ["away", indicators.away]] as const) {
    if (s.recentMatches === 0) {
      reasons.push({ code: `${label}-season-stats-only`, detail: `Only season statistics were saved for the ${label} team; no recent results to confirm current form.` });
    } else if (s.latestMatchAgeDays !== null && s.latestMatchAgeDays > RECENCY_BOUND_DAYS) {
      reasons.push({ code: `${label}-latest-match-old`, detail: `The ${label} team's latest saved result was ${s.latestMatchAgeDays} days old when the pick was written (limit ${RECENCY_BOUND_DAYS}).` });
    }
  }
  if (provenance) {
    for (const k of ["homeTeam", "awayTeam", "standings"] as const) {
      const p = provenance[k];
      if (p.status === "aged") reasons.push({ code: `${k}-aged`, detail: `${PROVENANCE_LABEL[k]} evidence was ${p.ageHours}h old at generation (limit ${p.toleranceHours}h for that kickoff distance).` });
      if (p.status === "superseded") reasons.push({ code: `${k}-superseded`, detail: `${PROVENANCE_LABEL[k]} evidence was missing a match played on ${p.supersededBy?.slice(0, 10)}.` });
      if (p.status === "unverified") reasons.push({ code: `${k}-unverified`, detail: `${PROVENANCE_LABEL[k]}: the outcome of a match on ${p.unverifiedMatch?.slice(0, 10)} could not be confirmed at generation.` });
    }
  } else if (!contextComplete) {
    reasons.push({ code: "historical-incomplete-flag", detail: "Generation marked this evidence as incomplete. Before 22 Nov 2026 that flag also covered evidence that existed but was past a freshness limit; the saved results are shown above." });
  }
  if (generatedAt && supersessionCheckable) {
    const fixtureKickoff = new Date(digest.fixture.kickoff);
    for (const [label, team] of [["home", home], ["away", away]] as const) {
      const s = assessSupersession({
        teamApiId: team?.apiId ?? null, evidenceAsOf: latestObservedMatch(team), known: input.known,
        now: generatedAt, fixtureKickoff: Number.isFinite(fixtureKickoff.getTime()) ? fixtureKickoff : null,
        evidenceMatches: team?.last5 ?? [],
      });
      if (s.superseded) reasons.push({ code: `${label}-missed-match`, detail: `The ${label} team had already played on ${s.superseded.toISOString().slice(0, 10)}, but that result was not in the saved evidence.` });
      else if (s.unverified) reasons.push({ code: `${label}-unconfirmed-match`, detail: `The ${label} team had a fixture on ${s.unverified.toISOString().slice(0, 10)} before generation whose result could not be confirmed; it is not in the saved evidence.` });
    }
  }
  return out(reasons.length ? "FRESHNESS_UNCERTAIN" : "EVIDENCE_AVAILABLE");
}

export const CLASS_LABEL: Record<HistoricalEvidenceClass, string> = {
  EVIDENCE_AVAILABLE: "Evidence available",
  FRESHNESS_UNCERTAIN: "Freshness uncertain",
  EVIDENCE_INSUFFICIENT: "Evidence insufficient",
  SNAPSHOT_UNAVAILABLE: "Snapshot unavailable",
  NOT_GENERATED: "Not generated",
};

/** The admin warning sentence for each class. Never used on public pages. */
export const CLASS_WARNING: Record<HistoricalEvidenceClass, string | null> = {
  EVIDENCE_AVAILABLE: null,
  FRESHNESS_UNCERTAIN: "Football evidence was saved, but whether it was current when this pick was written needs verification.",
  EVIDENCE_INSUFFICIENT: "Meaningful football evidence was missing when this pick was written. Statements in its reasoning may be unsupported.",
  SNAPSHOT_UNAVAILABLE: "The evidence behind this pick cannot be reconstructed. This does not show that the pick is wrong.",
  NOT_GENERATED: null,
};

/** The earliest moment a known match can count as already played at `generatedAt`. Exported for loaders. */
export function playedBefore(generatedAt: Date): Date {
  return new Date(generatedAt.getTime() - PLAYED_AFTER_KICKOFF_MS);
}
