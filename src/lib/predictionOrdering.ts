import { leaguePriorityRank } from "@/lib/leagues";

/**
 * The single display order for every list of picks on the site.
 *
 * CONFIDENCE LEADS. In any category, the highest-confidence pick sits at the
 * top; competition priority only breaks ties between picks of equal
 * confidence. A reader scanning a feed is asking "what is the strongest call
 * here", and the answer to that is the confidence figure printed on the card —
 * a list whose first row shows a lower number than the row beneath it reads as
 * broken, whatever ordering justifies it.
 *
 * This is deliberately NOT the ranking used to CHOOSE picks. Selection —
 * which picks become GENIUS/VIP/PREMIUM (selectCuratedIds in
 * src/lib/geniusCuration.ts) and which wins the Bet of the Day slot — still
 * leads with competition priority via compareByEditorialRank below, because
 * "which fixtures deserve featuring" is an editorial question and a Premier
 * League tie is worth more shop-window space than a Latvian one. The two
 * questions have different answers, so they have different comparators.
 *
 * Two properties this must have, and one it must not:
 *
 * - TOTAL. Every comparison ends in a decision, with `id` as the final
 *   tiebreaker. Two rows that agree on confidence and league would otherwise
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
    confidenceOf(b) - confidenceOf(a) ||
    leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Ranking used purely to CHOOSE picks — automatic curation, and Bet of the Day
 * selection. Every candidate here is an unsettled pick for today, so the
 * pending/settled split above is irrelevant.
 *
 * Competition priority leads here, unlike the display comparator: this decides
 * which fixtures are worth featuring at all, and that is an editorial judgement
 * about the fixture rather than a reading of the confidence figure. Kept beside
 * the display comparator precisely so the difference between the two is visible
 * in one file rather than being an accident spread across call sites.
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
