/**
 * What the match finder is currently narrowing by, in words, and how to take
 * one narrowing away. Pure; no database, no React.
 *
 * Before this, the "Filters" summary counted only some of the changes (a past
 * date counted as one "active" filter nobody set; a date the reader chose
 * counted as none), and clearing one filter meant opening the panel, resetting
 * a select and searching again. Each active filter is now one removable item,
 * and the count is the number of items.
 */
import { MARKET_LABELS, DISCOVERY_KEYS, type DiscoveryFilter, type DiscoveryParams } from "./predictionDiscovery";

export type ActiveFilter = { key: (typeof DISCOVERY_KEYS)[number]; label: string };

const WINDOW_LABELS: Record<string, string> = { morning: "Before 12:00", afternoon: "12:00–18:00", evening: "From 18:00", next6: "Next 6 hours" };
const STATE_LABELS: Record<string, string> = { upcoming: "Upcoming only", live: "Started / awaiting result", finished: "Finished", all: "All statuses" };
const PERSONAL_LABELS: Record<string, string> = { favourites: "Followed teams & competitions", markets: "Preferred markets", saved: "Saved predictions" };

/** "Sat 14 Nov" for a YYYY-MM-DD key (a calendar date, so no zone is involved). */
export function dateLabel(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  return Number.isFinite(+d) ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : key;
}

/**
 * The filters that differ from what the page shows with nothing set. The team
 * text is not listed: it is visible in its own box. `competitionName` and
 * `categoryLabel` are looked up by the caller (they come from its lists).
 */
export function activeFilters(f: DiscoveryFilter, names: { competition?: string; category?: string } = {}): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  if (f.date !== f.defaultDate) out.push({ key: "d_date", label: dateLabel(f.date) });
  if (f.competition != null) out.push({ key: "d_competition", label: names.competition ?? `Competition #${f.competition}` });
  if (f.market) out.push({ key: "d_market", label: MARKET_LABELS[f.market] ?? f.market });
  if (f.state !== f.defaultState) out.push({ key: "d_state", label: STATE_LABELS[f.state] });
  if (f.window !== "all") out.push({ key: "d_window", label: WINDOW_LABELS[f.window] });
  if (f.category) out.push({ key: "d_category", label: names.category ?? f.category });
  if (f.personal !== "all") out.push({ key: "d_personal", label: PERSONAL_LABELS[f.personal] });
  if (f.odds) out.push({ key: "d_odds", label: "With a bookmaker quote" });
  return out;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The same search with `drop` removed (and the page reset). Keeps the other filters and the day tab. */
export function withoutFilter(path: string, params: DiscoveryParams, drop: string | readonly string[]): string {
  const dropped = new Set(Array.isArray(drop) ? drop : [drop]);
  const q = new URLSearchParams();
  for (const k of DISCOVERY_KEYS) {
    const v = first(params[k]);
    if (v && k !== "d_page" && !dropped.has(k)) q.set(k, v.slice(0, 100));
  }
  const day = first(params.date);
  if (day) q.set("date", day);
  const s = q.toString();
  return `${path}${s ? `?${s}` : ""}#discover`;
}

export type EmptyState = { text: string; actions: { label: string; href: string }[] };

/**
 * What to say when nothing matches. Names what the search was limited by, so a
 * match outside the chosen date or status is not mistaken for no match at all,
 * and offers the two things that most often fix it, as links.
 */
export function emptyState(f: DiscoveryFilter, path: string, params: DiscoveryParams, names: { competition?: string } = {}): EmptyState {
  const limits: string[] = [];
  if (f.team) limits.push(`“${f.team}”`);
  limits.push(dateLabel(f.date));
  if (f.state !== "all") limits.push(STATE_LABELS[f.state].toLowerCase());
  if (f.market) limits.push(MARKET_LABELS[f.market] ?? f.market);
  if (f.competition != null) limits.push(names.competition ?? `competition #${f.competition}`);
  if (f.window !== "all") limits.push(WINDOW_LABELS[f.window]);
  const actions: EmptyState["actions"] = [];
  if (f.state !== "all") actions.push({ label: "Include started and finished", href: withoutFilter(path, { ...params, d_state: "all" }, []) });
  const narrowed = !!f.team || activeFilters(f).length > 0;
  if (narrowed) actions.push({ label: "Clear all filters", href: withoutFilter(path, params, [...DISCOVERY_KEYS]) });
  return { text: `No published predictions for ${limits.join(" · ")}.`, actions };
}
