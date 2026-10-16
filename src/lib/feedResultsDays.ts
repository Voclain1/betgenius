/**
 * The pure half of the past-days results (src/lib/feedResults.ts): constants,
 * day keys and labels, and the row shape. No database or server imports, so
 * the client section (src/components/FeedResults.tsx) can use it.
 */

/** Days listed at first, and added by each "Show more days". */
export const FEED_RESULTS_PAGE_DAYS = 7;
/** How far back a reader can page. A bound on the route, not a retention policy. */
export const FEED_RESULTS_MAX_DAYS_BACK = 90;

/** A YYYY-MM-DD key moved by whole days. Pure calendar arithmetic, the same on server and client. */
export function shiftDayKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Saturday, 10 October" for a day key. Independent of the server's and the reader's time zone. */
export function resultsDayLabel(key: string): string {
  return new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
}

export type DayResult = {
  id: string;
  homeTeam: string | null;
  awayTeam: string | null;
  /** API-Football team ids, for the crests; null on rows saved without them. */
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  kickoff: string | null;
  market: string;
  /** null when the reader cannot view the category. */
  pick: string | null;
  /** WON | LOST | VOID | PENDING */
  outcome: string;
};

