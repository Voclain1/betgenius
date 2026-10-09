/**
 * Long prediction lists (league, cup and team pages) split at "now": the
 * matches still to come first, soonest first, then the ones already played,
 * latest first, each paged so a page with hundreds of picks opens on a short
 * list. Free of React and `window`, so the split, the paging and the stored
 * "hide past" preference are checked without a browser
 * (scripts/check-prediction-timeline.tsx).
 */

/** Picks shown before "Show more", per group. */
export const PREDICTION_PAGE_SIZE = 20;

/** A match counts as played two hours after kickoff; until then it stays with the upcoming (and live) picks. */
export const PLAYED_AFTER_MS = 2 * 60 * 60_000;

type Kicked = { kickoff?: string | Date | null; fixture?: { kickoff: string | Date } | null };

const kickoffMs = (r: Kicked): number | null => {
  const k = r.kickoff ?? r.fixture?.kickoff;
  if (!k) return null;
  const t = new Date(k).getTime();
  return Number.isNaN(t) ? null : t;
};

/** Upcoming (and in play), soonest first; played, latest first. A row with no kickoff counts as played. */
export function splitByKickoff<T extends Kicked>(rows: T[], now: Date = new Date()): { upcoming: T[]; past: T[] } {
  const cutoff = now.getTime() - PLAYED_AFTER_MS;
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const r of rows) {
    const t = kickoffMs(r);
    (t != null && t > cutoff ? upcoming : past).push(r);
  }
  upcoming.sort((a, b) => kickoffMs(a)! - kickoffMs(b)!);
  past.sort((a, b) => (kickoffMs(b) ?? 0) - (kickoffMs(a) ?? 0));
  return { upcoming, past };
}

/** Consecutive pages of `size`; none for an empty list. */
export function pages<T>(rows: T[], size: number = PREDICTION_PAGE_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** One key for every page: a reader who hides played matches once expects it everywhere. */
export const HIDE_PAST_KEY = "betgenius-hide-past-predictions";

type Store = Pick<Storage, "getItem" | "setItem">;

/** Never throws; anything unreadable means "show them" (the server-rendered default). */
export function readHidePast(storage: Store | null | undefined): boolean {
  try {
    return storage?.getItem(HIDE_PAST_KEY) === "1";
  } catch {
    return false;
  }
}

/** Never throws: failing to remember the choice must not stop it applying. */
export function writeHidePast(storage: Store | null | undefined, hide: boolean): void {
  try {
    storage?.setItem(HIDE_PAST_KEY, hide ? "1" : "0");
  } catch {
    // The choice still applies on this page; it just won't carry over.
  }
}
