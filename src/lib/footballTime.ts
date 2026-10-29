/** Public football times use WAT, independent of server/browser timezone. */
export const FOOTBALL_TIME_ZONE = "Africa/Lagos";
export function footballDate(value: Date | string, options: NonNullable<Parameters<Date["toLocaleString"]>[1]> = {}): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: FOOTBALL_TIME_ZONE }).format(date);
}
const withZone = (label: string) => label === "Time unavailable" ? label : `${label} WAT`;
export const kickoffLabel = (value: Date | string) => withZone(`${footballDate(value, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`);
export const kickoffTime = (value: Date | string) => withZone(`${footballDate(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`);
export const footballDay = (value: Date | string) => footballDate(value, { weekday: "long", day: "numeric", month: "long" });
export const footballDayKey = (value: Date | string) => footballDate(value, { year: "numeric", month: "2-digit", day: "2-digit" });
