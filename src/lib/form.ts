// Team form rating — a recency-weighted read of a team's last few results,
// derived from the fixtures TeamEnrichmentCache already stores. Pure functions
// over that list, like src/lib/h2h.ts: no API calls, no database, no cache of
// its own, so the arithmetic is checkable in isolation.
//
// DISPLAY ONLY. This rating is deliberately NOT passed to the model at
// generation time — whether a computed metric should influence what the AI
// predicts is a separate decision that needs evaluating against real settled
// outcomes, not a side effect of building a UI feature. If that changes, it
// changes in src/lib/ai/generate.ts with its own reasoning, not by something
// quietly importing this module.
//
// Opponent strength is deliberately not modelled: beating the league leader
// and beating the bottom club count the same here. That's the known coarseness
// of this version — standings-weighted form is a real improvement but brings
// cross-league comparability problems worth taking on separately.

import type { TeamFixtureSummary } from "@/lib/enrichment";

/**
 * Below this many usable fixtures the rating is withheld entirely rather than
 * shown with a caveat — same posture as MIN_SETTLED_SAMPLE_SIZE on the track
 * record page, where too small a sample is treated as no answer rather than a
 * quiet one.
 */
export const MIN_FORM_SAMPLE = 3;

/** Fixtures beyond this are ignored even if cached — "form" means the recent run, and the weights below are calibrated for a 5-match window. */
export const FORM_WINDOW = 5;

/**
 * Recency weights, most recent first. Roughly linear rather than steep: the
 * most recent match counts ~2.3x the fifth-most-recent, which is enough to let
 * a new run show through without letting one result dominate the number.
 */
const RECENCY_WEIGHTS = [1, 0.85, 0.7, 0.55, 0.43];

/** Per-match goal difference is clamped here before scoring — a 7-0 shouldn't read as meaningfully better form than a 4-0. */
const GD_CLAMP = 3;

/** How much of the score is results vs goal difference. Results dominate: winning is the point, margin is corroboration. */
const RESULT_WEIGHT = 0.7;
const GD_WEIGHT = 0.3;

export type FormBand = "Excellent" | "Strong" | "Average" | "Poor" | "Very poor";

export type FormRating = {
  /** 0-100. */
  score: number;
  band: FormBand;
  /** Fixtures actually scored — never more than FORM_WINDOW. */
  sample: number;
  wins: number;
  draws: number;
  losses: number;
  /** Net goal difference across the sample, or null when no fixture carried a score. */
  goalDiff: number | null;
  /** False when scores were missing and the rating is results-only (older cache rows). */
  usedGoalDiff: boolean;
  /** Most recent first, e.g. ["W","W","D"] — the sequence the badge renders. */
  sequence: string[];
};

export function bandFor(score: number): FormBand {
  if (score >= 80) return "Excellent";
  if (score >= 65) return "Strong";
  if (score >= 45) return "Average";
  if (score >= 30) return "Poor";
  return "Very poor";
}

/** Tailwind classes per band — kept beside the thresholds so a new band can't be added without a colour. */
export const FORM_BAND_STYLES: Record<FormBand, string> = {
  Excellent: "bg-emerald-500/20 text-emerald-300",
  Strong: "bg-brand/20 text-brand",
  Average: "bg-gray-500/20 text-gray-300",
  Poor: "bg-orange-500/20 text-orange-300",
  "Very poor": "bg-red-500/20 text-red-300",
};

const RESULT_POINTS: Record<string, number> = { W: 1, D: 0.5, L: 0 };

/**
 * Scores a team's recent fixtures.
 *
 * Returns null when fewer than MIN_FORM_SAMPLE fixtures have a usable result —
 * callers render the "not enough data" state rather than a number nobody
 * should trust. A fixture with an unknown result ("?" from a match the API had
 * no score for) is dropped, not counted as a draw.
 *
 * Both halves of the score are on the same 0-1 scale before weighting: result
 * points as-is, and goal difference mapped so that 0 is an even game, +GD_CLAMP
 * is 1 and -GD_CLAMP is 0. A team with no scores cached is rated on results
 * alone, with the result half renormalised to the full scale so it isn't
 * silently capped at 70.
 */
export function computeFormRating(fixtures: TeamFixtureSummary[] | null | undefined): FormRating | null {
  if (!fixtures?.length) return null;

  // Cache order isn't guaranteed, so sort explicitly — the recency weights are
  // meaningless if the list isn't newest-first.
  const usable = [...fixtures]
    .filter((f) => RESULT_POINTS[f.result] !== undefined)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, FORM_WINDOW);

  if (usable.length < MIN_FORM_SAMPLE) return null;

  const scored = usable.filter((f) => f.goalsFor != null && f.goalsAgainst != null);
  const usedGoalDiff = scored.length === usable.length;

  let resultNumerator = 0;
  let gdNumerator = 0;
  let weightTotal = 0;

  usable.forEach((f, i) => {
    const w = RECENCY_WEIGHTS[i] ?? RECENCY_WEIGHTS[RECENCY_WEIGHTS.length - 1];
    resultNumerator += RESULT_POINTS[f.result] * w;
    if (usedGoalDiff) {
      const gd = Math.max(-GD_CLAMP, Math.min(GD_CLAMP, (f.goalsFor as number) - (f.goalsAgainst as number)));
      gdNumerator += (gd / GD_CLAMP / 2 + 0.5) * w;
    }
    weightTotal += w;
  });

  const resultScore = resultNumerator / weightTotal;
  const raw = usedGoalDiff ? resultScore * RESULT_WEIGHT + (gdNumerator / weightTotal) * GD_WEIGHT : resultScore;
  const score = Math.round(raw * 100);

  const goalDiff = scored.length > 0 ? scored.reduce((n, f) => n + (f.goalsFor as number) - (f.goalsAgainst as number), 0) : null;

  return {
    score,
    band: bandFor(score),
    sample: usable.length,
    wins: usable.filter((f) => f.result === "W").length,
    draws: usable.filter((f) => f.result === "D").length,
    losses: usable.filter((f) => f.result === "L").length,
    goalDiff,
    usedGoalDiff,
    sequence: usable.map((f) => f.result),
  };
}

/** "3W-1D-1L, +5 goal difference" — the caveat line under a rating, stating the sample it came from. */
export function formSummaryLine(rating: FormRating): string {
  const record = `${rating.wins}W-${rating.draws}D-${rating.losses}L`;
  const gd = rating.goalDiff == null ? null : `${rating.goalDiff > 0 ? "+" : ""}${rating.goalDiff} goal difference`;
  return [`Last ${rating.sample} ${rating.sample === 1 ? "match" : "matches"}`, record, gd].filter(Boolean).join(" · ");
}
