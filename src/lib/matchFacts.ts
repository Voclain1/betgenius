/**
 * Match-specific statistical factors, derived from the cached TeamDigest.
 *
 * Pure functions over already-fetched data — no API calls, no database, no
 * cache of its own — exactly like src/lib/h2h.ts and src/lib/form.ts. That is
 * what makes the arithmetic below checkable in isolation, which matters here
 * because every number this produces is published as fact.
 *
 * Two rules run through the whole module:
 *
 *   1. A rate needs a sample. Below MIN_RATE_SAMPLE matches a percentage moves
 *      by 20+ points on a single result, so it is withheld entirely rather than
 *      shown with a caveat — the same posture as MIN_FORM_SAMPLE in form.ts and
 *      MIN_SETTLED_SAMPLE_SIZE on the track record page.
 *   2. Missing means null, never zero. A team with no cached statistics is not
 *      a team that never scores, and the split between those two readings is
 *      the entire difference between a useful page and a misleading one.
 *
 * The venue split is the point of this module. A home team's HOME record
 * against an away team's AWAY record is the comparison that bears on the
 * fixture; the combined season figures both sides' pages already show do not.
 */

import type { TeamDigest, Split3, RecordSplit } from "@/lib/ai/digest";

/** Below this many matches, percentage rates are withheld rather than shown. */
export const MIN_RATE_SAMPLE = 5;

/**
 * Below this many matches, per-game averages are withheld too.
 *
 * Lower than MIN_RATE_SAMPLE because an average is steadier than a percentage
 * over a small sample, but emphatically not 1: a side whose only home game was
 * a 7-0 genuinely reported "7 goals per game" until this floor existed, which
 * is a worse answer than no answer. Verified against Casa Pia vs Benfica in the
 * live data, one match into the Primeira Liga season.
 */
export const MIN_AVERAGE_SAMPLE = 3;

/** One team's venue-specific profile for this fixture — home figures for the home side, away for the away side. */
export type VenueProfile = {
  /** "home" for the home team, "away" for the away team — which split these numbers came from. */
  venue: "home" | "away";
  played: number;
  win: number;
  draw: number;
  loss: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Goals scored/conceded per game at this venue, from api-football's own averages where present, else derived. */
  scoredPerGame: number | null;
  concededPerGame: number | null;
  /** Percentages 0-100, null below MIN_RATE_SAMPLE. */
  cleanSheetPct: number | null;
  failedToScorePct: number | null;
};

const pct = (n: number, of: number): number | null => (of <= 0 ? null : Number(((n / of) * 100).toFixed(0)));
const perGame = (total: number, played: number): number | null => (played <= 0 ? null : Number((total / played).toFixed(2)));

function splitFor(d: TeamDigest, venue: "home" | "away"): RecordSplit | null {
  return venue === "home" ? d.home : d.away;
}

function rateFor(s: Split3 | null, venue: "home" | "away"): number | null {
  if (!s) return null;
  return venue === "home" ? s.home : s.away;
}

/**
 * The venue-specific profile for one side of this fixture.
 *
 * Returns null when the team has no record for that venue — which is the normal
 * case early in a season, not an error. Clean-sheet and failed-to-score
 * percentages are computed against the same venue's games played, and withheld
 * below MIN_RATE_SAMPLE even when the underlying counts exist.
 */
export function venueProfile(digest: TeamDigest | null | undefined, venue: "home" | "away"): VenueProfile | null {
  if (!digest) return null;
  const split = splitFor(digest, venue);
  if (!split || split.played <= 0) return null;

  const cleanSheets = rateFor(digest.cleanSheets, venue);
  const failedToScore = rateFor(digest.failedToScore, venue);
  const enoughForRates = split.played >= MIN_RATE_SAMPLE;
  const enoughForAverages = split.played >= MIN_AVERAGE_SAMPLE;

  // api-football reports its own per-venue averages; prefer them, since they're
  // the figure its other surfaces quote. Fall back to deriving from the split
  // when the averages block is absent (older/sparser responses).
  const avgFor = rateFor(digest.goalsForAvg, venue);
  const avgAgainst = rateFor(digest.goalsAgainstAvg, venue);

  return {
    venue,
    played: split.played,
    win: split.win,
    draw: split.draw,
    loss: split.loss,
    goalsFor: split.goalsFor,
    goalsAgainst: split.goalsAgainst,
    // Gated on the same count as the record they summarise. api-football's own
    // average is preferred where present, but it is just as meaningless off one
    // match as a derived one, so the floor applies to both.
    scoredPerGame: enoughForAverages ? (avgFor ?? perGame(split.goalsFor, split.played)) : null,
    concededPerGame: enoughForAverages ? (avgAgainst ?? perGame(split.goalsAgainst, split.played)) : null,
    cleanSheetPct: enoughForRates && cleanSheets != null ? pct(cleanSheets, split.played) : null,
    failedToScorePct: enoughForRates && failedToScore != null ? pct(failedToScore, split.played) : null,
  };
}

/** A rate computed from the last-5 list, with the sample it came from so the page can qualify it. */
export type RecentRate = { pct: number; sample: number };

/**
 * Rates over a team's recent matches — the only place BTTS and over-2.5 can be
 * computed from, since api-football's team statistics carry neither.
 *
 * Derived from the cached last-5 fixtures, so the sample is small by
 * construction and the caller is told exactly how small. Fixtures without a
 * scoreline are excluded rather than counted as 0-0.
 */
export function recentGoalRates(digest: TeamDigest | null | undefined): { btts: RecentRate | null; over25: RecentRate | null; avgTotalGoals: number | null } {
  const scored = (digest?.last5 ?? []).filter((f) => f.goalsFor != null && f.goalsAgainst != null);
  if (scored.length < MIN_RATE_SAMPLE) return { btts: null, over25: null, avgTotalGoals: null };

  const btts = scored.filter((f) => (f.goalsFor as number) > 0 && (f.goalsAgainst as number) > 0).length;
  const over25 = scored.filter((f) => (f.goalsFor as number) + (f.goalsAgainst as number) > 2.5).length;
  const totalGoals = scored.reduce((n, f) => n + (f.goalsFor as number) + (f.goalsAgainst as number), 0);

  return {
    btts: { pct: pct(btts, scored.length)!, sample: scored.length },
    over25: { pct: pct(over25, scored.length)!, sample: scored.length },
    avgTotalGoals: Number((totalGoals / scored.length).toFixed(2)),
  };
}

export type MatchFacts = {
  home: VenueProfile | null;
  away: VenueProfile | null;
  homeRecent: ReturnType<typeof recentGoalRates>;
  awayRecent: ReturnType<typeof recentGoalRates>;
  /**
   * Combined expected goal environment: the home side's home scoring rate plus
   * the away side's away scoring rate. Stated as what it is — an addition of two
   * observed averages, not a model — and null unless BOTH sides have one, since
   * half of it would be worse than none.
   */
  combinedGoalRate: number | null;
};

export function buildMatchFacts(home: TeamDigest | null | undefined, away: TeamDigest | null | undefined): MatchFacts {
  const h = venueProfile(home, "home");
  const a = venueProfile(away, "away");
  const combined = h?.scoredPerGame != null && a?.scoredPerGame != null ? Number((h.scoredPerGame + a.scoredPerGame).toFixed(2)) : null;

  return {
    home: h,
    away: a,
    homeRecent: recentGoalRates(home),
    awayRecent: recentGoalRates(away),
    combinedGoalRate: combined,
  };
}

/** True when there is genuinely nothing to render — callers hide the section rather than showing empty rows. */
export function isMatchFactsEmpty(f: MatchFacts): boolean {
  return !f.home && !f.away && !f.homeRecent.btts && !f.awayRecent.btts;
}

// ---------------------------------------------------------------------------
// Availability freshness
// ---------------------------------------------------------------------------

/**
 * How stale availability data may be before the page must say so.
 *
 * Team news moves daily in the days before a fixture. Presenting a list read a
 * week ago as current is the one way this page could actively mislead, so past
 * this threshold the reader is told when it was read instead of being left to
 * assume it is current. Below it, no stamp — the app deliberately removed
 * per-section cache stamps, and reintroducing them everywhere would undo that.
 */
export const AVAILABILITY_STALE_DAYS = 3;

export type AvailabilityFreshness =
  /** No team-news feed resolved for this side at all. NOT the same as "nobody is out". */
  | { state: "unavailable" }
  /** Read recently enough to present as current. */
  | { state: "current" }
  /** Materially old — the page shows the date it was read. */
  | { state: "stale"; asOf: string; ageDays: number };

/**
 * Classify an availability list's freshness.
 *
 * `asOf` is the matchday the absences were read from (see
 * selectCurrentAvailability in src/lib/ai/digest.ts), not the cache write time
 * — what matters to a reader is which round of fixtures the list describes.
 *
 * A digest with no asOf means the feed never resolved. That is reported as
 * "unavailable" and must never be rendered as an empty (i.e. fully fit) squad —
 * the distinction the whole team-news panel exists to preserve.
 */
export function availabilityFreshness(digest: TeamDigest | null | undefined, now: Date = new Date()): AvailabilityFreshness {
  if (!digest || !digest.availabilityAsOf) return { state: "unavailable" };
  const asOf = new Date(`${digest.availabilityAsOf}T00:00:00Z`);
  if (isNaN(asOf.getTime())) return { state: "unavailable" };

  const ageDays = Math.floor((now.getTime() - asOf.getTime()) / 86_400_000);
  if (ageDays > AVAILABILITY_STALE_DAYS) return { state: "stale", asOf: digest.availabilityAsOf, ageDays };
  return { state: "current" };
}

/** The four states the team-news panel must keep distinct. Collapsing any two of these is a correctness bug, not a UI simplification. */
export type TeamNewsState =
  | { kind: "unavailable" }
  | { kind: "none-reported"; freshness: AvailabilityFreshness }
  | { kind: "absences"; injuries: TeamDigest["availability"]; suspensions: TeamDigest["availability"]; other: TeamDigest["availability"]; freshness: AvailabilityFreshness };

/**
 * Resolve one side's team-news state.
 *
 * The ordering matters: "feed never resolved" is checked BEFORE the list is
 * inspected, so an empty list from a failed fetch can never be reported as
 * "no reported absences". Injuries, suspensions and other absences stay in
 * separate buckets because they mean different things — a suspension is certain
 * and self-resolving, an injury is neither, and "not selected" is neither of
 * those and must not be written up as an injury.
 */
export function teamNewsState(digest: TeamDigest | null | undefined, now: Date = new Date()): TeamNewsState {
  const freshness = availabilityFreshness(digest, now);
  if (freshness.state === "unavailable") return { kind: "unavailable" };

  const list = digest?.availability ?? [];
  if (list.length === 0) return { kind: "none-reported", freshness };

  return {
    kind: "absences",
    injuries: list.filter((e) => e.kind === "injury"),
    suspensions: list.filter((e) => e.kind === "suspension"),
    other: list.filter((e) => e.kind === "unavailable"),
    freshness,
  };
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export type ConfidenceBand = "Strong" | "Solid" | "Moderate" | "Tentative";

/**
 * Bands for the headline verdict.
 *
 * Presentation only — this does NOT feed settlement, scoring or the model, and
 * the underlying confidence number is rendered alongside it everywhere it
 * appears. The bands exist so a reader can tell a 78% call from a 46% one
 * without reading the bar, not to add a second opinion on top of the first.
 *
 * The ceiling is 90 (generate.ts clamps there), so "Strong" is genuinely the
 * top of the range rather than a band nothing reaches.
 */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 75) return "Strong";
  if (confidence >= 60) return "Solid";
  if (confidence >= 45) return "Moderate";
  return "Tentative";
}

export const CONFIDENCE_BAND_STYLES: Record<ConfidenceBand, string> = {
  Strong: "bg-emerald-500/20 text-emerald-300",
  Solid: "bg-brand/20 text-brand",
  Moderate: "bg-gray-500/20 text-gray-300",
  Tentative: "bg-orange-500/20 text-orange-300",
};

/**
 * The one-line verdict.
 *
 * Template-assembled from the pick, market and confidence that are already
 * stored on the prediction — the same posture as h2hTrendLine in
 * src/lib/h2h.ts. It restates the call in a sentence; it does not add a
 * judgement, and it cannot say anything the row beneath it doesn't corroborate.
 *
 * Deliberately NOT an AI field: adding a "verdict" to the model's output would
 * change the prompt and the output schema, invalidating every previously
 * generated prediction, to produce a sentence that is fully determined by data
 * already on the row.
 */
export function verdictLine(input: { market: string; pick: string; confidence: number; overUnder?: string | null }): string {
  const band = confidenceBand(input.confidence);
  const lead = `BetGenius backs ${input.pick} (${input.market}) at ${input.confidence}% confidence — a ${band.toLowerCase()} call.`;
  return input.overUnder ? `${lead} Total goals: ${input.overUnder}.` : lead;
}
