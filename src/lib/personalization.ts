/**
 * Sprint 01 personalization: the rules, with no database and no React.
 *
 * Everything here is pure so scripts/check-personalization.ts can assert it
 * directly, and client-safe so the preferences UI can share the same market
 * list, timezone validation and input limits the API enforces. The database
 * half lives in src/lib/personalizationData.ts.
 *
 * See docs/sprints/sprint-01-personalization.md.
 */
import { z } from "zod";
import { resolveMarket, isValidSelection, type MarketType } from "@/lib/markets";
import { comparePredictionsForDisplay, type DisplayRankable } from "@/lib/predictionOrdering";
import { LEAGUE_CATALOGUE, MAJOR_LEAGUE_IDS } from "@/lib/leagues";

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

/**
 * The markets a reader can prefer: every market type the app actually
 * publishes, nothing it doesn't.
 *
 * Typed as a Record over MarketType minus the two that are not a market a
 * reader backs on its own — OTHER (the free-text admin escape hatch) and
 * SAME_GAME_DOUBLE (composed from two other picks). Adding a market type to
 * src/lib/markets.ts without deciding its label here is a compile error, so
 * this list cannot drift from the application's configuration.
 */
export type PreferenceMarket = Exclude<MarketType, "OTHER" | "SAME_GAME_DOUBLE">;

const MARKET_COPY: Record<PreferenceMarket, { label: string; hint: string; order: number }> = {
  MATCH_WINNER: { label: "Match winner", hint: "Home, draw or away (1X2)", order: 1 },
  DOUBLE_CHANCE: { label: "Double chance", hint: "Two of the three results", order: 2 },
  BTTS: { label: "Both teams to score", hint: "Yes or no", order: 3 },
  OVER_UNDER: { label: "Over/Under goals", hint: "Total match goals", order: 4 },
  TEAM_TOTAL: { label: "Team goals", hint: "One side's goal total", order: 5 },
  DRAW_NO_BET: { label: "Draw no bet", hint: "Stake returned on a draw", order: 6 },
  WIN_EITHER_HALF: { label: "Win either half", hint: "A side wins at least one half", order: 7 },
  HT_FT: { label: "Half-time / full-time", hint: "Both results in one pick", order: 8 },
  EUROPEAN_HANDICAP: { label: "Handicap", hint: "Three-way goal handicap", order: 9 },
  CORRECT_SCORE: { label: "Correct score", hint: "The exact final score", order: 10 },
};

export const PREFERENCE_MARKETS: ReadonlyArray<{ type: PreferenceMarket; label: string; hint: string }> = (
  Object.entries(MARKET_COPY) as Array<[PreferenceMarket, (typeof MARKET_COPY)[PreferenceMarket]]>
)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([type, c]) => ({ type, label: c.label, hint: c.hint }));

const PREFERENCE_MARKET_SET: ReadonlySet<string> = new Set(PREFERENCE_MARKETS.map((m) => m.type));

export function isPreferenceMarket(value: unknown): value is PreferenceMarket {
  return typeof value === "string" && PREFERENCE_MARKET_SET.has(value);
}

export function marketPreferenceLabel(type: string): string {
  return isPreferenceMarket(type) ? MARKET_COPY[type].label : type;
}

// ---------------------------------------------------------------------------
// Timezones
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEZONE = "Africa/Lagos";

/** Offered first in the picker; every other valid IANA zone is still accepted. */
export const COMMON_TIMEZONES = [
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Africa/Cairo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Istanbul",
  "Asia/Dubai",
  "Asia/Kolkata",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "UTC",
] as const;

/**
 * A recognised IANA identifier, nothing looser. Intl accepts some inputs we
 * do not want stored (offsets like "+01:00", any letter case), so the value
 * must also be spelled as an identifier: capitalised segments, or "UTC".
 * Not a round-trip check — ICU canonicalises some valid identifiers to older
 * aliases (Asia/Kolkata resolves as Asia/Calcutta), which would reject them.
 */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length < 3 || tz.length > 64) return false;
  if (tz !== "UTC" && !/^[A-Z][A-Za-z_]*(\/[A-Z][A-Za-z0-9_+\-]*){1,2}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A stored value that is no longer valid (or missing) falls back rather than throwing at render. */
export function safeTimeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
}

/** Minutes the zone is ahead of UTC at `at`. */
function zoneOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The calendar date in `tz`, as YYYY-MM-DD. */
export function zonedDateKey(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: safeTimeZone(tz), year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/**
 * [start, end) of the reader's current day in their own timezone, as UTC
 * instants. Computed per call from Intl, so DST transitions resolve correctly
 * (the offset is re-read at the candidate midnight, not assumed from "now").
 */
export function zonedDayBounds(tz: string, now: Date = new Date()): { start: Date; end: Date } {
  const zone = safeTimeZone(tz);
  const [y, m, d] = zonedDateKey(zone, now).split("-").map(Number);
  const midnight = (year: number, month: number, day: number) => {
    const guess = Date.UTC(year, month - 1, day);
    let t = guess - zoneOffsetMinutes(zone, new Date(guess)) * 60000;
    t = guess - zoneOffsetMinutes(zone, new Date(t)) * 60000;
    return new Date(t);
  };
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return { start: midnight(y, m, d), end: midnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()) };
}

/** Short zone label: "WAT" for Lagos (the site's convention), otherwise what Intl gives ("GMT", "CET", "GMT+4"). */
export function zoneAbbreviation(tz: string, at: Date = new Date()): string {
  const zone = safeTimeZone(tz);
  if (zone === "Africa/Lagos") return "WAT";
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? zone;
}

/** Intl's formatting options, spelled via the constructor so no identifier here reads like ad-tag config. */
type DateFormatOpts = NonNullable<ConstructorParameters<typeof Intl.DateTimeFormat>[1]>;

function formatIn(tz: string, value: Date | string, options: DateFormatOpts): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: safeTimeZone(tz) }).format(date);
}

/** "Sat 15:00 WAT" in the reader's zone. */
export function kickoffInZone(value: Date | string, tz: string): string {
  const label = formatIn(tz, value, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return label ? `${label} ${zoneAbbreviation(tz, new Date(value))}` : "Time unavailable";
}

/** "15:00" in the reader's zone. */
export function timeInZone(value: Date | string, tz: string): string {
  return formatIn(tz, value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) ?? "—";
}

/** "Friday 13 November" in the reader's zone. */
export function longDateInZone(value: Date | string, tz: string): string {
  return formatIn(tz, value, { weekday: "long", day: "numeric", month: "long" }) ?? "";
}

/** "13 Nov" in the reader's zone. */
export function shortDateInZone(value: Date | string, tz: string): string {
  return formatIn(tz, value, { day: "numeric", month: "short" }) ?? "";
}

// ---------------------------------------------------------------------------
// Input validation (shared by the API and the client forms)
// ---------------------------------------------------------------------------

export const LIMITS = {
  teams: 40,
  leagues: 30,
  markets: PREFERENCE_MARKETS.length,
  saved: 500,
} as const;

/** A provider id: positive integer, sent as number or digit string. Never a name. */
const ProviderId = z.union([z.number().int().positive().max(10_000_000), z.string().regex(/^\d{1,8}$/).transform(Number)]);

export const PreferencesUpdate = z
  .object({
    timezone: z.string().max(64).refine(isValidTimeZone, "Choose a valid timezone").optional(),
    preferredMarkets: z.array(z.string()).max(LIMITS.markets).refine((a) => a.every(isPreferenceMarket), "Unknown market").optional(),
    teamIds: z.array(ProviderId).max(LIMITS.teams, `Up to ${LIMITS.teams} teams`).optional(),
    leagueIds: z.array(ProviderId).max(LIMITS.leagues, `Up to ${LIMITS.leagues} competitions`).optional(),
    onboarding: z.enum(["complete", "skip"]).optional(),
  })
  .strict();
export type PreferencesUpdateInput = z.infer<typeof PreferencesUpdate>;

/** Order-preserving de-duplication; the API stores each id once whatever the client sends. */
export function uniqueIds(ids: readonly number[]): number[] {
  return Array.from(new Set(ids));
}

export const SaveRequest = z.object({ predictionId: z.string().regex(/^[a-z0-9]{8,40}$/i, "Invalid prediction id") }).strict();

/** Diff two id sets: what to add and what to remove. Pure. */
export function diffIds(current: readonly number[], next: readonly number[]): { add: number[]; remove: number[] } {
  const cur = new Set(current);
  const nxt = new Set(next);
  return { add: [...nxt].filter((id) => !cur.has(id)), remove: [...cur].filter((id) => !nxt.has(id)) };
}

// ---------------------------------------------------------------------------
// Competitions shown first in the picker
// ---------------------------------------------------------------------------

/**
 * Commonly followed competitions lead; the rest of the catalogue follows in
 * catalogue order, so nothing is excluded. Women's competitions keep their
 * catalogue position rather than being promoted.
 */
export function orderedCompetitions(): Array<{ id: number; name: string; country: string; popular: boolean }> {
  const popular = new Set<number>([...MAJOR_LEAGUE_IDS, 3, 45, 40, 1, 4]);
  const rows = LEAGUE_CATALOGUE.map((l) => ({ id: l.id, name: l.name, country: l.country, popular: popular.has(l.id) }));
  const order = [...MAJOR_LEAGUE_IDS, 3, 45, 40, 1, 4] as number[];
  return [
    ...order.map((id) => rows.find((r) => r.id === id)).filter((r): r is (typeof rows)[number] => !!r),
    ...rows.filter((r) => !popular.has(r.id)),
  ];
}

export function isCatalogueLeague(id: number): boolean {
  return LEAGUE_CATALOGUE.some((l) => l.id === id);
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

/**
 * How recent an account must be for the dashboard to open the setup flow
 * instead of the overview. Same reasoning as SIGNUP_UPSELL_WINDOW_MS: every
 * account that predates this deploy is far outside a day, so shipping it
 * cannot sweep the existing user base into a forced flow — they get the
 * dashboard invitation instead.
 */
export const ONBOARDING_WINDOW_MS = 24 * 60 * 60 * 1000;

export type OnboardingFacts = {
  createdAt: Date;
  /** A UserPreference row exists: they completed, skipped or saved settings before. */
  hasPreferenceRow: boolean;
  /** Any team or league follow, made before this feature existed. */
  favouriteCount: number;
  now?: Date;
};

/** Redirect to /dashboard/welcome? Only brand-new accounts that have not personalised anything. */
export function shouldStartOnboarding(f: OnboardingFacts): boolean {
  if (f.hasPreferenceRow || f.favouriteCount > 0) return false;
  const age = (f.now ?? new Date()).getTime() - f.createdAt.getTime();
  return age >= 0 && age < ONBOARDING_WINDOW_MS;
}

/** Show the small "personalise your dashboard" invitation? Anyone who has not set anything up and has not dismissed it. */
export function shouldInviteToPersonalize(f: Omit<OnboardingFacts, "createdAt" | "now"> & { skipped: boolean; completed: boolean; marketCount: number }): boolean {
  if (f.completed) return false;
  return f.favouriteCount === 0 && f.marketCount === 0 && !f.skipped;
}

// ---------------------------------------------------------------------------
// Ranking today's predictions
// ---------------------------------------------------------------------------

export type Interests = {
  teamIds: ReadonlySet<number>;
  leagueIds: ReadonlySet<number>;
  markets: ReadonlySet<string>;
};

export function hasInterests(i: Interests): boolean {
  return i.teamIds.size > 0 || i.leagueIds.size > 0 || i.markets.size > 0;
}

export type RankableRow = DisplayRankable & {
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  marketType?: string | null;
};

export type MatchReason = "team" | "league" | "market";

export type RankedRow<T> = { row: T; score: number; reasons: MatchReason[] };

const WEIGHTS = { team: 1000, league: 400, market: 150 } as const;

/**
 * How much "when" matters: a pick still to play scores up to 100, falling 4
 * points an hour so tonight's match outranks one the reader has all day for;
 * one that has started but not settled scores 10 (it can still be followed);
 * a settled pick is pushed below every live pick, whatever it matches.
 */
export function kickoffRelevance(row: { kickoff?: Date | string | null; outcome?: string | null }, now: Date): number {
  if (row.outcome && row.outcome !== "PENDING") return -2000;
  if (!row.kickoff) return 0;
  const hours = (new Date(row.kickoff).getTime() - now.getTime()) / 3_600_000;
  if (!Number.isFinite(hours)) return 0;
  if (hours < 0) return 10;
  return Math.max(20, Math.round(100 - hours * 4));
}

export function matchReasons(row: RankableRow, i: Interests): MatchReason[] {
  const out: MatchReason[] = [];
  if ((row.homeTeamApiId != null && i.teamIds.has(row.homeTeamApiId)) || (row.awayTeamApiId != null && i.teamIds.has(row.awayTeamApiId))) out.push("team");
  if (row.leagueApiId != null && i.leagueIds.has(row.leagueApiId)) out.push("league");
  if (row.marketType && i.markets.has(row.marketType)) out.push("market");
  return out;
}

/**
 * Order: followed teams, then followed leagues, then preferred markets, then
 * kickoff relevance, then the site's own display ranking as the tie-break.
 * The weights are far enough apart that a lower signal can never outrank a
 * higher one: the most a market+kickoff can add (250) is below one league
 * match (400), and a league+market+kickoff (650) is below one team (1000).
 */
export function rankPersonalized<T extends RankableRow>(rows: readonly T[], i: Interests, now: Date = new Date()): RankedRow<T>[] {
  return rows
    .map((row) => {
      const reasons = matchReasons(row, i);
      const score = reasons.reduce((s, r) => s + WEIGHTS[r], 0) + kickoffRelevance(row, now);
      return { row, score, reasons };
    })
    .sort((a, b) => b.score - a.score || comparePredictionsForDisplay(a.row, b.row));
}

// ---------------------------------------------------------------------------
// Upcoming fixtures for followed teams and leagues
// ---------------------------------------------------------------------------

export type UpcomingSource = {
  fixtureApiId?: number | null;
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  leagueApiId?: number | null;
  leagueName?: string | null;
  kickoff: Date | string;
  /** Present when a published prediction exists for the fixture. */
  predictionHref?: string | null;
  /** A settled prediction means the match is over, whatever the kickoff says. */
  outcome?: string | null;
};

export type UpcomingFixture = {
  key: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  leagueApiId: number | null;
  leagueName: string | null;
  kickoff: Date;
  status: "Scheduled" | "Starting soon";
  hasPrediction: boolean;
  href: string | null;
  followedTeam: boolean;
};

function fixtureKey(s: UpcomingSource): string {
  const day = new Date(s.kickoff).toISOString().slice(0, 10);
  return s.homeTeamApiId != null && s.awayTeamApiId != null ? `${s.homeTeamApiId}-${s.awayTeamApiId}-${day}` : `${s.homeTeam}|${s.awayTeam}|${day}`.toLowerCase();
}

/**
 * Merge fixture sources (league caches and published predictions) into one
 * de-duplicated, chronological list involving the reader's teams or leagues.
 *
 * NEVER UPCOMING: anything at or before `now`, and anything whose prediction
 * has settled. A cache refreshed yesterday still lists last night's match as
 * "NS"; the kickoff check is what keeps it off this list.
 */
export function buildUpcoming(sources: readonly UpcomingSource[], teamIds: ReadonlySet<number>, leagueIds: ReadonlySet<number>, now: Date = new Date(), limit = 12): UpcomingFixture[] {
  const byKey = new Map<string, UpcomingFixture>();
  const settledKeys = new Set<string>();
  for (const s of sources) {
    const kickoff = new Date(s.kickoff);
    if (!Number.isFinite(kickoff.getTime())) continue;
    const key = fixtureKey(s);
    if (s.outcome && s.outcome !== "PENDING") {
      settledKeys.add(key);
      continue;
    }
    if (kickoff.getTime() <= now.getTime()) continue;
    const followedTeam = (s.homeTeamApiId != null && teamIds.has(s.homeTeamApiId)) || (s.awayTeamApiId != null && teamIds.has(s.awayTeamApiId));
    const followedLeague = s.leagueApiId != null && leagueIds.has(s.leagueApiId);
    if (!followedTeam && !followedLeague) continue;
    const existing = byKey.get(key);
    const minutes = (kickoff.getTime() - now.getTime()) / 60000;
    const next: UpcomingFixture = {
      key,
      homeTeam: s.homeTeam,
      awayTeam: s.awayTeam,
      homeTeamApiId: s.homeTeamApiId ?? existing?.homeTeamApiId ?? null,
      awayTeamApiId: s.awayTeamApiId ?? existing?.awayTeamApiId ?? null,
      leagueApiId: s.leagueApiId ?? existing?.leagueApiId ?? null,
      leagueName: s.leagueName ?? existing?.leagueName ?? null,
      kickoff,
      status: minutes <= 120 ? "Starting soon" : "Scheduled",
      hasPrediction: !!s.predictionHref || !!existing?.hasPrediction,
      href: s.predictionHref ?? existing?.href ?? null,
      followedTeam: followedTeam || !!existing?.followedTeam,
    };
    byKey.set(key, next);
  }
  return [...byKey.values()]
    .filter((f) => !settledKeys.has(f.key))
    .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || a.key.localeCompare(b.key))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Saved predictions: what to show for a bookmark
// ---------------------------------------------------------------------------

export type SavedSnapshot = {
  category: string;
  marketType: string;
  selection: unknown;
  market: string;
  pick: string;
  odds: number | null;
  confidence: number | null;
  kickoff: Date | null;
};

export type LivePrediction = {
  status: string;
  marketType: string;
  selection: unknown;
  pick: string;
  outcome: string;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  kickoff: Date | null;
} | null;

export type SavedState = "upcoming" | "awaiting" | "settled" | "unavailable";

export type SavedView = {
  state: SavedState;
  /** WON / LOST / VOID for the selection the reader SAVED, or null. */
  outcome: "WON" | "LOST" | "VOID" | null;
  /** The live pick, when it has been changed since the reader saved it. */
  changedTo: string | null;
  finalScore: string | null;
  locked: boolean;
};

function sameSelection(a: { marketType: string; selection: unknown; pick: string }, b: { marketType: string; selection: unknown; pick: string }): boolean {
  if (a.marketType !== b.marketType) return false;
  if (a.marketType !== "OTHER" && a.selection != null && b.selection != null) return JSON.stringify(a.selection) === JSON.stringify(b.selection);
  return a.pick.trim() === b.pick.trim();
}

/**
 * The bookmark as the reader saved it, settled honestly.
 *
 * - The pick shown is ALWAYS the snapshot. If the live row was rewritten,
 *   `changedTo` carries the new pick so the page can say so; it is never
 *   substituted silently.
 * - Settlement is the live outcome only when the live selection is still the
 *   saved one. After a rewrite the live outcome describes a different pick,
 *   so the saved selection is resolved from the final score instead, with the
 *   same resolver auto-settlement uses — or left unresolved if it cannot be.
 * - `locked` (the reader cannot view the category now) hides the outcome as
 *   well as the pick: a win/loss on a locked pick is part of what is paid for.
 */
export function savedPredictionView(snapshot: SavedSnapshot, live: LivePrediction, canView: boolean, now: Date = new Date()): SavedView {
  const finalScore = live && live.finalHomeScore != null && live.finalAwayScore != null ? `${live.finalHomeScore}–${live.finalAwayScore}` : null;
  if (!live) {
    return { state: "unavailable", outcome: null, changedTo: null, finalScore: null, locked: !canView };
  }
  const same = sameSelection(snapshot, live);
  const liveSettled = live.outcome === "WON" || live.outcome === "LOST" || live.outcome === "VOID";
  let outcome: SavedView["outcome"] = null;
  if (same) {
    outcome = liveSettled ? (live.outcome as "WON" | "LOST" | "VOID") : null;
  } else {
    if (live.finalHomeScore != null && live.finalAwayScore != null && snapshot.marketType !== "OTHER" && snapshot.marketType !== "SAME_GAME_DOUBLE") {
      const mt = snapshot.marketType as MarketType;
      if (isValidSelection(mt, snapshot.selection)) outcome = resolveMarket(mt, snapshot.selection, live.finalHomeScore, live.finalAwayScore);
    }
    // A void with no score (abandoned, postponed past the window) voids every
    // selection on the fixture, the saved one included.
    if (!outcome && live.outcome === "VOID" && live.finalHomeScore == null) outcome = "VOID";
  }
  const kickoff = live.kickoff ?? snapshot.kickoff;
  // Once the live row has settled the match is over: the saved pick is
  // settled too, even when its own result cannot be derived (a rewritten
  // free-text or half-time market). It is then "settled, result unavailable",
  // never left waiting forever.
  const state: SavedState = outcome || liveSettled
    ? "settled"
    : kickoff && kickoff.getTime() > now.getTime()
      ? "upcoming"
      : "awaiting";
  if (!canView) return { state, outcome: null, changedTo: null, finalScore: state === "settled" ? finalScore : null, locked: true };
  return { state, outcome, changedTo: same ? null : live.pick, finalScore, locked: false };
}

export const SAVED_FILTERS = ["all", "upcoming", "settled", "won", "lost"] as const;
export type SavedFilter = (typeof SAVED_FILTERS)[number];
export function parseSavedFilter(v: unknown): SavedFilter {
  return (SAVED_FILTERS as readonly unknown[]).includes(v) ? (v as SavedFilter) : "all";
}

/**
 * Whether a bookmark belongs under a filter — decided from its SavedView, the
 * same value the row displays, so the list and the row can never disagree.
 * Won/Lost exclude locked rows: listing a padlocked pick under "Won" would
 * reveal the result the lock withholds.
 */
export function matchesSavedFilter(view: SavedView, filter: SavedFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "upcoming":
      return view.state === "upcoming";
    case "settled":
      return view.state === "settled";
    case "won":
      return !view.locked && view.outcome === "WON";
    case "lost":
      return !view.locked && view.outcome === "LOST";
  }
}

type Orderable = { id: string; kickoff: Date | null; settledAt?: Date | null; view: SavedView };
const ms = (d: Date | null | undefined) => (d ? d.getTime() : null);

/** Upcoming: soonest first. Everything else: latest kickoff first, undated last. Ties by id, so pages are stable. */
export function orderSaved<T extends Orderable>(items: readonly T[], filter: SavedFilter): T[] {
  const asc = filter === "upcoming";
  return [...items].sort((a, b) => {
    const ka = ms(a.kickoff);
    const kb = ms(b.kickoff);
    if (ka !== kb) {
      if (ka == null) return 1;
      if (kb == null) return -1;
      return asc ? ka - kb : kb - ka;
    }
    return asc ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
  });
}

/** The overview's "recently settled": settled bookmarks, latest settlement first (kickoff when no settlement time). */
export function recentlySettled<T extends Orderable>(items: readonly T[], limit: number): T[] {
  return items
    .filter((i) => i.view.state === "settled")
    .sort((a, b) => (ms(b.settledAt) ?? ms(b.kickoff) ?? 0) - (ms(a.settledAt) ?? ms(a.kickoff) ?? 0) || b.id.localeCompare(a.id))
    .slice(0, limit);
}
