/**
 * Bounded Lagos day navigation for daily published predictions.
 * Historical days remain stable; future dates are browsable up to +14 days.
 * Opening a future date does not claim a prediction exists there.
 * Pure and client-safe: no database or authentication imports.
 */
import { lagosDayBounds, lagosDayLabel } from "./lagosDate";

export const FEED_DAYS = [
  "yesterday", "today", "tomorrow", "day-2", "day-3",
  "day-4", "day-5", "day-6", "day-7",
  "day-8", "day-9", "day-10", "day-11", "day-12", "day-13", "day-14",
] as const;

export type FeedDay = (typeof FEED_DAYS)[number];
const OFFSETS: Record<FeedDay, number> = {
  yesterday: -1, today: 0, tomorrow: 1,
  "day-2": 2, "day-3": 3, "day-4": 4,
  "day-5": 5, "day-6": 6, "day-7": 7,
  "day-8": 8, "day-9": 9, "day-10": 10, "day-11": 11,
  "day-12": 12, "day-13": 13, "day-14": 14,
};
export const feedDayOffset = (day: FeedDay): number => OFFSETS[day];

export function parseFeedDay(input: string | string[] | undefined): FeedDay {
  const value = Array.isArray(input) ? input[0] : input;
  return (FEED_DAYS as readonly string[]).includes(value ?? "") ? value as FeedDay : "today";
}

export const dayShowsOutcomes = (day: FeedDay): boolean => feedDayOffset(day) <= 0;
export const dayHref = (basePath: string, day: FeedDay): string =>
  day === "today" ? basePath : `${basePath}?date=${day}`;
export const feedDayHref = (slug: string, day: FeedDay): string =>
  dayHref(`/predictions/${slug}`, day);

const SHORT = new Intl.DateTimeFormat("en-NG", {
  timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short",
});

/** Short tab label, for example Sat 21 Nov. */
export function feedDayTabLabel(day: FeedDay, anchor = new Date()): string {
  if (day === "yesterday") return "Yesterday";
  if (day === "today") return "Today";
  if (day === "tomorrow") return "Tomorrow";
  const parts = SHORT.formatToParts(lagosDayBounds(feedDayOffset(day), anchor).start);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/** Human-friendly copy instead of a raw day-4 query token. */
export function feedDayText(day: FeedDay, anchor = new Date()): string {
  return day === "yesterday" || day === "today" || day === "tomorrow"
    ? day : lagosDayLabel(feedDayOffset(day), anchor);
}
export function feedDayTitle(day: FeedDay, anchor = new Date()): string {
  const s = feedDayText(day, anchor);
  return s[0].toUpperCase() + s.slice(1);
}

/** Consistent two-line date tiles, with a fully expanded screen-reader label. */
export function feedDayTile(day: FeedDay, anchor = new Date()): {
  eyebrow: string; date: string; fullDate: string;
} {
  const start = lagosDayBounds(feedDayOffset(day), anchor).start;
  const parts = SHORT.formatToParts(start);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value ?? "";
  const eyebrow = day === "today" ? "Today"
    : day === "yesterday" ? "Yesterday"
    : day === "tomorrow" ? "Tomorrow" : part("weekday");
  return {
    eyebrow,
    date: `${part("day")} ${part("month")}`,
    fullDate: lagosDayLabel(feedDayOffset(day), anchor),
  };
}
