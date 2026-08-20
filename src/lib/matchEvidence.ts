/**
 * How much verified evidence a match page actually carries.
 *
 * This exists to answer one question: should this page ask to be indexed?
 *
 * At volume, a match page whose caches are cold renders little more than a pick
 * and a short preview. Publishing hundreds of those invites a thin-content
 * assessment across the whole /predictions/match/ directory, which costs the
 * pages that ARE substantial. So the page still renders normally for readers —
 * a reader who followed a link should always get what we have — but it stays
 * `noindex, follow` until it carries enough to be worth ranking.
 *
 * Deliberately NOT "does teamDigestJson exist". A page can be genuinely useful
 * with no team digest at all (a strong head-to-head record, a league table
 * position and a real analysis is a good page), and nearly useless with one
 * (an unplayed season produces a digest of nulls). Scoring independent signals
 * means one cold cache cannot by itself suppress a substantial page, and one
 * warm cache cannot by itself promote an empty one.
 *
 * Pure functions over data the page already has — no I/O, same posture as
 * matchFacts.ts and h2h.ts.
 */

import type { TeamDigest } from "@/lib/ai/digest";
import type { H2HMeeting } from "@/lib/h2h";
import type { LeagueStandingRow } from "@/lib/enrichment";
import { computeFormRating } from "@/lib/form";
import { venueProfile, teamNewsState } from "@/lib/matchFacts";
import { parseAnalysis } from "@/lib/predictionAnalysis";

export type EvidenceSignal =
  /** Either side has a season record — the backbone of any statistical claim. */
  | "teamData"
  /** Either side has enough recent fixtures to rate form. */
  | "recentForm"
  /** A venue-split comparison can be drawn for at least one side. */
  | "statistics"
  /** These two have met often enough for the record to mean something. */
  | "headToHead"
  /** The league table locates at least one of them. */
  | "standings"
  /** A team-news feed resolved for at least one side. */
  | "teamNews"
  /** A real preview and/or key factors — the interpretive layer. */
  | "analysis";

/**
 * Signal weights.
 *
 * STRONG signals (2) each carry a section a reader could not get from the
 * fixture list alone. WEAK signals (1) are real but thin on their own: a league
 * position or a "no reported absences" line is corroboration, not substance.
 *
 * The three digest-derived signals co-occur by construction — a warm team cache
 * yields teamData, recentForm and statistics together, scoring 6 and clearing
 * the threshold on its own. That is intended: a fixture with both sides' form,
 * records and venue splits IS a substantial page. The threshold's real work is
 * on the other path, where no digest exists and the page has to earn indexing
 * from head-to-head, standings, team news and analysis instead.
 */
const WEIGHTS: Record<EvidenceSignal, number> = {
  teamData: 2,
  recentForm: 2,
  statistics: 2,
  headToHead: 2,
  analysis: 2,
  standings: 1,
  teamNews: 1,
};

/** Maximum attainable score, derived rather than hard-coded so a new signal can't desync it. */
export const MAX_EVIDENCE_SCORE = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

/**
 * The bar for asking to be indexed.
 *
 * Five of a possible twelve. Concretely that means:
 *   - a warm team cache alone (6) passes;
 *   - head-to-head + analysis + any weak signal (5) passes;
 *   - analysis + standings + team news (4) does NOT — a pick, a table row and
 *     "nobody is injured" is not a page worth ranking.
 *
 * Set by walking real fixtures rather than picked round: the sparse Premier
 * League and La Liga cases from the digest validation land at 4-6 depending on
 * whether their h2h resolved, which is the right place for the line to fall.
 */
export const EVIDENCE_THRESHOLD = 5;

/** Meetings needed before a head-to-head record counts as evidence — below this it's an anecdote. */
const MIN_H2H_MEETINGS = 3;

/** A preview shorter than this is a stub, not analysis. */
const MIN_PREVIEW_CHARS = 200;

export type MatchEvidence = {
  signals: Record<EvidenceSignal, boolean>;
  /** Present signals, for logging and the admin view — never rendered to readers. */
  present: EvidenceSignal[];
  score: number;
  threshold: number;
  /** True when the page carries enough verified content to ask to be indexed. */
  substantive: boolean;
};

export type EvidenceInput = {
  homeDigest: TeamDigest | null;
  awayDigest: TeamDigest | null;
  standings: LeagueStandingRow[] | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  h2hMeetings: H2HMeeting[];
  matchPreview: string | null;
  analysisJson: unknown;
};

/**
 * Score the evidence behind one match page.
 *
 * Every signal is "either side qualifies", not "both". A fixture where only the
 * home side's cache is warm still has real form and real statistics on the
 * page; requiring both would suppress it for a reason the reader wouldn't
 * recognise.
 */
export function assessMatchEvidence(input: EvidenceInput): MatchEvidence {
  const { homeDigest: home, awayDigest: away } = input;

  const hasTeamData = !!(home?.overall || away?.overall);

  // Reuses the form rating's own sample rule rather than inventing a second
  // one — if the page won't rate the form, it isn't evidence of form.
  const hasRecentForm = !!(computeFormRating(home?.last5) || computeFormRating(away?.last5));

  // Same venue-split rule the statistics panel renders from, so this can't
  // claim a comparison the page then declines to show.
  const hasStatistics = !!(venueProfile(home, "home") || venueProfile(away, "away"));

  const hasH2H =
    input.h2hMeetings.length >= MIN_H2H_MEETINGS && input.homeTeamApiId != null && input.awayTeamApiId != null;

  // A table row only counts when the side has actually played — an alphabetical
  // preseason position locates nobody.
  const ids = new Set([input.homeTeamApiId, input.awayTeamApiId].filter((id): id is number => id != null));
  const hasStandings = !!input.standings?.some((r) => ids.has(r.teamId) && r.played > 0);

  // "unavailable" means the feed never resolved; both "none-reported" and a
  // real absence list are evidence. See teamNewsState for why that distinction
  // is load-bearing.
  const hasTeamNews = teamNewsState(home).kind !== "unavailable" || teamNewsState(away).kind !== "unavailable";

  const hasAnalysis =
    (input.matchPreview?.trim().length ?? 0) >= MIN_PREVIEW_CHARS || parseAnalysis(input.analysisJson) !== null;

  const signals: Record<EvidenceSignal, boolean> = {
    teamData: hasTeamData,
    recentForm: hasRecentForm,
    statistics: hasStatistics,
    headToHead: hasH2H,
    standings: hasStandings,
    teamNews: hasTeamNews,
    analysis: hasAnalysis,
  };

  const present = (Object.keys(signals) as EvidenceSignal[]).filter((k) => signals[k]);
  const score = present.reduce((n, k) => n + WEIGHTS[k], 0);

  return { signals, present, score, threshold: EVIDENCE_THRESHOLD, substantive: score >= EVIDENCE_THRESHOLD };
}
