import { leaguePriorityRank } from "@/lib/leagues";

/**
 * The single display order for every list of picks on the site.
 *
 * The ranking itself — league priority first, then confidence descending — is
 * the same one automatic curation already uses to decide WHICH picks become
 * GENIUS/VIP/PREMIUM (see selectCuratedIds in src/lib/geniusCuration.ts, which
 * imports its comparator from here so there is exactly one definition of
 * "strongest pick" in the codebase). Applying it to display order too means a
 * visitor meets the same editorial judgement on every feed, not only inside the
 * curated tiers: previously these lists came back in publish order, so a
 * 92%-confidence Premier League pick sat below whatever was approved most
 * recently.
 *
 * Two properties this must have, and one it must not:
 *
 * - TOTAL. Every comparison ends in a decision, with `id` as the final
 *   tiebreaker. Two rows that agree on league and confidence would otherwise
 *   be left in whatever order the database happened to return, which can
 *   differ between requests — that is exactly the reorder-on-every-reload
 *   jitter this ordering has to avoid. Nothing here reads the clock or any
 *   other per-request value either, so the same rows always produce the same
 *   sequence. See scripts/check-display-ordering.ts.
 *
 * - HISTORY STAYS CHRONOLOGICAL. Settled picks sort after pending ones and
 *   among themselves by kickoff, newest first. A league or team page is partly
 *   an archive; reordering last month's results by confidence would scramble a
 *   record people read as a timeline. Confidence ranking answers "which pick
 *   should I look at now", which only pending rows are competing on.
 */
export type DisplayRankable = {
  id: string;
  leagueApiId?: number | null;
  confidence?: number | null;
  outcome?: string | null;
  kickoff?: Date | string | null;
  publishedAt?: Date | string | null;
};

const time = (value: Date | string | null | undefined): number => {
  if (!value) return 0;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * A locked row arrives with `confidence: null` (the paywall blanks it before
 * render). Treating that as 0 would sink every paywalled pick to the bottom of
 * a VIP feed — the opposite of the intent — so a missing confidence sorts as
 * if it were average rather than worst.
 */
const confidenceOf = (row: DisplayRankable): number => row.confidence ?? 50;

const isSettled = (row: DisplayRankable): boolean => !!row.outcome && row.outcome !== "PENDING";

/** The comparator behind both display ordering and automatic curation. */
export function comparePredictionsForDisplay(a: DisplayRankable, b: DisplayRankable): number {
  const settledA = isSettled(a);
  const settledB = isSettled(b);
  if (settledA !== settledB) return settledA ? 1 : -1;

  if (settledA) {
    return time(b.kickoff) - time(a.kickoff) || time(b.publishedAt) - time(a.publishedAt) || a.id.localeCompare(b.id);
  }

  return (
    leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId) ||
    confidenceOf(b) - confidenceOf(a) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Ranking used purely to CHOOSE picks (curation), where every candidate is an
 * unsettled pick for today and the pending/settled split above is irrelevant.
 * Kept beside the display comparator so the two can never drift apart.
 */
export function compareByEditorialRank(a: DisplayRankable, b: DisplayRankable): number {
  return (
    leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId) ||
    confidenceOf(b) - confidenceOf(a) ||
    a.id.localeCompare(b.id)
  );
}

/** Non-mutating sort — callers hand in query results they may also read unsorted. */
export function orderForDisplay<T extends DisplayRankable>(rows: readonly T[]): T[] {
  return [...rows].sort(comparePredictionsForDisplay);
}
