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

/** Half-open UTC bounds for the current Lagos calendar date. */
export function lagosTodayBounds(now: Date = new Date()): { start: Date; end: Date } {
  const key = lagosDateKey(now);
  const start = new Date(`${key}T00:00:00${LAGOS_OFFSET}`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60_000) };
}

export function isLagosToday(date: Date | string, now: Date = new Date()): boolean {
  return lagosDateKey(date) === lagosDateKey(now);
}
