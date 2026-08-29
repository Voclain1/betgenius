const LAGOS_OFFSET = "+01:00";

/** Calendar date (YYYY-MM-DD) in Africa/Lagos for a point in time. */
export function lagosDateKey(date: Date | string = new Date()): string {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

/**
 * Half-open UTC bounds for a Lagos calendar date, offset by whole days.
 *
 * offsetDays 0 is today, -1 yesterday, +1 tomorrow. The offset is applied to
 * the Lagos DATE KEY rather than by adding 24h to an instant, so a day is
 * always the calendar day a reader in Lagos would name — the two only differ
 * across a DST change, which Lagos does not observe, but deriving it from the
 * key keeps that true by construction rather than by luck.
 */
export function lagosDayBounds(offsetDays = 0, now: Date = new Date()): { start: Date; end: Date } {
  const key = lagosDateKey(now);
  const base = new Date(`${key}T00:00:00${LAGOS_OFFSET}`);
  const shifted = new Date(base.getTime() + offsetDays * 24 * 60 * 60_000);
  const start = new Date(`${lagosDateKey(shifted)}T00:00:00${LAGOS_OFFSET}`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60_000) };
}

/** Half-open UTC bounds for the current Lagos calendar date. */
export function lagosTodayBounds(now: Date = new Date()): { start: Date; end: Date } {
  return lagosDayBounds(0, now);
}

export function isLagosToday(date: Date | string, now: Date = new Date()): boolean {
  return lagosDateKey(date) === lagosDateKey(now);
}
