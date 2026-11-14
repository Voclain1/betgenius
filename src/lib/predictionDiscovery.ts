import { MARKET_TYPES } from "./markets";
import { safeTimeZone, zonedDateKey, zonedDayBounds } from "./personalization";

export type DiscoveryParams = Record<string, string | string[] | undefined>;
export const DISCOVERY_PAGE_SIZE = 12;
export const DISCOVERY_LIMIT = 300;
export const MARKET_LABELS: Record<string, string> = {
  MATCH_WINNER: "Match winner",
  DOUBLE_CHANCE: "Double chance",
  OVER_UNDER: "Total goals",
  BTTS: "Both teams to score",
  CORRECT_SCORE: "Correct score",
  WIN_EITHER_HALF: "Win either half",
  DRAW_NO_BET: "Draw no bet",
  HT_FT: "Half-time / full-time",
  TEAM_TOTAL: "Team goals",
  EUROPEAN_HANDICAP: "European handicap",
  SAME_GAME_DOUBLE: "Combo Bet",
  OTHER: "Other markets",
};
export const DISCOVERY_KEYS = [
  "d_date",
  "d_competition",
  "d_team",
  "d_market",
  "d_window",
  "d_state",
  "d_category",
  "d_odds",
  "d_personal",
  "d_page",
] as const;
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;
export function hasDiscoveryFilters(p: DiscoveryParams = {}) {
  return DISCOVERY_KEYS.some((k) => !!first(p[k]));
}

/** Resolve a calendar date in the reader's zone, including UTC+14 and DST days. */
export function discoveryDay(date: string, zone: string) {
  let anchor = new Date(`${date}T12:00:00Z`);
  for (let i = 0; i < 2; i++) {
    const actual = zonedDateKey(zone, anchor);
    anchor = new Date(+anchor + Date.parse(date) - Date.parse(actual));
  }
  return zonedDayBounds(zone, anchor);
}
export function parseDiscovery(
  p: DiscoveryParams = {},
  timezone?: string,
  now = new Date(),
  fallbackDay = "today",
) {
  const zone = safeTimeZone(timezone),
    today = zonedDateKey(zone, now),
    notices: string[] = [];
  const relative = new Date(`${today}T12:00:00Z`);
  relative.setUTCDate(
    relative.getUTCDate() +
      (fallbackDay === "yesterday" ? -1 : fallbackDay === "tomorrow" ? 1 : 0),
  );
  let date = first(p.d_date) || relative.toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date ||
    Math.abs(Date.parse(date) - Date.parse(today)) > 31 * 86400000
  ) {
    date = today;
    notices.push("Choose a date within 31 days of today.");
  }
  const pick = <T extends string>(
    v: string | undefined,
    values: readonly T[],
    fallback: T,
  ): T => (values.includes(v as T) ? (v as T) : fallback);
  const n = Number(first(p.d_competition));
  return {
    date,
    zone,
    bounds: discoveryDay(date, zone),
    notices,
    competition: Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null,
    team: (first(p.d_team) ?? "").trim().slice(0, 80),
    market: pick(first(p.d_market), ["", ...MARKET_TYPES], ""),
    window: pick(
      first(p.d_window),
      ["all", "morning", "afternoon", "evening", "next6"],
      "all",
    ),
    state: pick(
      first(p.d_state),
      ["upcoming", "live", "finished", "all"],
      date < today ? "finished" : "upcoming",
    ),
    category: first(p.d_category)?.slice(0, 32) ?? "",
    odds: first(p.d_odds) === "quoted",
    personal: pick(
      first(p.d_personal),
      ["all", "favourites", "markets", "saved"],
      "all",
    ),
    page: Math.min(25, Math.max(1, Math.floor(Number(first(p.d_page)) || 1))),
  };
}
export type DiscoveryFilter = ReturnType<typeof parseDiscovery>;
export function discoveryHref(
  path: string,
  params: DiscoveryParams,
  page: number,
) {
  const q = new URLSearchParams();
  for (const k of DISCOVERY_KEYS) {
    const v = first(params[k]);
    if (v && k !== "d_page") q.set(k, v.slice(0, 100));
  }
  if (params.date) q.set("date", first(params.date)!);
  q.set("d_page", String(page));
  return `${path}?${q.toString()}#discover`;
}
export function discoveryPhase(
  kickoff: Date,
  outcome: string,
  fixtureStatus?: string | null,
) {
  if (["FT", "AET", "PEN"].includes(fixtureStatus ?? "")) return "finished";
  if (
    ["PST", "CANC", "ABD", "AWD", "WO", "SUSP", "INT"].includes(
      fixtureStatus ?? "",
    ) ||
    outcome === "VOID"
  )
    return "unavailable";
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE"].includes(fixtureStatus ?? ""))
    return "live";
  return null; // caller resolves elapsed versus scheduled using its shared clock
}
export function matchesDiscoveryTime(
  kickoff: Date,
  f: DiscoveryFilter,
  now: Date,
) {
  if (f.window === "next6")
    return kickoff > now && +kickoff <= +now + 6 * 3600000;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: f.zone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(kickoff),
  );
  return (
    f.window === "all" ||
    (f.window === "morning"
      ? hour < 12
      : f.window === "afternoon"
        ? hour >= 12 && hour < 18
        : hour >= 18)
  );
}
