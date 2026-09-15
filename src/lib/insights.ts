/**
 * Match Insights: deterministic team trends from verified completed matches.
 *
 * Pure by design — no database, no network — so every rule below is testable
 * against hand-built histories (scripts/check-insights.ts). The worker in
 * src/lib/insightRefresh.ts supplies the history and the target fixture.
 *
 * Accuracy rules, each of which exists because the naive version lies:
 *
 * - Regulation time only. A match decided in extra time or on penalties is
 *   judged on its 90-minute score, the same basis bookmakers settle 1X2, goals
 *   and BTTS markets on (see regulationScoreOf in settlement.ts). A 1-1 that
 *   was lost on penalties is a draw here, not a defeat.
 * - Friendlies are excluded. Pre-season results say nothing about competitive
 *   form and would otherwise dominate a summer history.
 * - Unplayed fixtures (postponed, cancelled, abandoned) are skipped, but a
 *   completed match whose score cannot be verified, or an awarded result, ENDS
 *   the usable history. Skipping it instead could join two runs of results
 *   that were never actually consecutive.
 * - A streak is only "exact" when an older verified match disproves it.
 *   Otherwise the history ran out first, and the copy says "at least".
 */

export const INSIGHT_VERSION = "2";
/** Matches requested per team. One API call regardless of size. */
export const HISTORY_SIZE = 20;
/** Fewest verified matches in a scope before any insight is stated. */
export const MIN_SAMPLE = 5;
/** Frequency insights look at this many of the most recent matches. */
export const FREQUENCY_WINDOW = 10;
export const MIN_STREAK = 3;
export const MIN_FREQUENCY = 0.7;

const COMPLETED = new Set(["FT", "AET", "PEN"]);
/** A result exists but no football was played — its score proves nothing. */
const AWARDED = new Set(["AWD", "WO"]);
const FRIENDLY = /friendl/i;

export type InsightScope = "ALL" | "HOME" | "AWAY" | "COMPETITION";
export type InsightType =
  | "WIN_STREAK" | "UNBEATEN_STREAK" | "LOSS_STREAK" | "WINLESS_STREAK"
  | "OVER_25" | "BTTS" | "SCORED_2" | "CLEAN_SHEET" | "FAILED_TO_SCORE";

export const INSIGHT_TYPE_LABELS: Record<InsightType, string> = {
  WIN_STREAK: "Winning run",
  UNBEATEN_STREAK: "Unbeaten run",
  LOSS_STREAK: "Losing run",
  WINLESS_STREAK: "Winless run",
  OVER_25: "Over 2.5 goals",
  BTTS: "Both teams scored",
  SCORED_2: "Scored 2+",
  CLEAN_SHEET: "Clean sheets",
  FAILED_TO_SCORE: "Failed to score",
};

/** One fixture as stored in TeamFixtureHistory.fixtures. */
export type InsightFixture = {
  id: number;
  date: string;
  status: string;
  leagueId: number;
  leagueName: string;
  homeId: number;
  homeName: string;
  awayId: number;
  awayName: string;
  /** Regulation-time score; null when the provider's breakdown did not verify. */
  home: number | null;
  away: number | null;
};

export type InsightMatch = {
  id: number;
  date: string;
  opponent: string;
  venue: "home" | "away";
  goalsFor: number;
  goalsAgainst: number;
  leagueName: string;
  /** True on the older match that ended a streak. */
  breaksStreak?: boolean;
};

export type InsightEvidence = {
  type: InsightType;
  scope: InsightScope;
  teamApiId: number;
  teamName: string;
  /** Set for COMPETITION scope only. */
  leagueApiId: number | null;
  leagueName: string | null;
  count: number;
  sampleSize: number;
  exact: boolean;
  matches: InsightMatch[];
  explanation: string;
  /** 0–1, used only to order insights on the page. */
  strength: number;
  calculationVersion: string;
};

export type InsightOptions = {
  teamApiId: number;
  teamName: string;
  scope: InsightScope;
  /** Required for COMPETITION scope. */
  leagueApiId?: number | null;
  leagueName?: string | null;
  /** Only matches that kicked off before this instant are considered. */
  cutoff: Date;
};

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** Guards JSON read back from the database; malformed rows are dropped, never trusted. */
export function isInsightFixture(value: unknown): value is InsightFixture {
  const f = value as InsightFixture;
  return !!f
    && isInt(f.id) && typeof f.date === "string" && !Number.isNaN(Date.parse(f.date))
    && typeof f.status === "string" && isInt(f.leagueId) && typeof f.leagueName === "string"
    && isInt(f.homeId) && isInt(f.awayId) && typeof f.homeName === "string" && typeof f.awayName === "string"
    && (f.home === null || (isInt(f.home) && f.home >= 0))
    && (f.away === null || (isInt(f.away) && f.away >= 0));
}

type Verified = { fixture: InsightFixture; own: number; against: number; venue: "home" | "away" };

/**
 * The scope's usable history, newest first, cut at the first match that cannot
 * be verified.
 */
export function verifiedHistory(input: unknown, options: InsightOptions): Verified[] {
  if (!Array.isArray(input)) return [];
  if (options.scope === "COMPETITION" && options.leagueApiId == null) return [];

  const byId = new Map<number, InsightFixture>();
  for (const row of input) {
    if (!isInsightFixture(row)) continue;
    if (row.homeId !== options.teamApiId && row.awayId !== options.teamApiId) continue;
    if (new Date(row.date) >= options.cutoff) continue;
    if (FRIENDLY.test(row.leagueName)) continue;
    if (options.scope === "HOME" && row.homeId !== options.teamApiId) continue;
    if (options.scope === "AWAY" && row.awayId !== options.teamApiId) continue;
    if (options.scope === "COMPETITION" && row.leagueId !== options.leagueApiId) continue;
    byId.set(row.id, row);
  }

  const ordered = [...byId.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const out: Verified[] = [];
  for (const fixture of ordered) {
    if (AWARDED.has(fixture.status)) break;
    if (!COMPLETED.has(fixture.status)) continue;
    if (fixture.home === null || fixture.away === null) break;
    const venue = fixture.homeId === options.teamApiId ? "home" : "away";
    out.push({
      fixture,
      venue,
      own: venue === "home" ? fixture.home : fixture.away,
      against: venue === "home" ? fixture.away : fixture.home,
    });
  }
  return out;
}

function toMatch(v: Verified, breaksStreak = false): InsightMatch {
  return {
    id: v.fixture.id,
    date: v.fixture.date,
    opponent: v.venue === "home" ? v.fixture.awayName : v.fixture.homeName,
    venue: v.venue,
    goalsFor: v.own,
    goalsAgainst: v.against,
    leagueName: v.fixture.leagueName,
    ...(breaksStreak ? { breaksStreak: true } : {}),
  };
}

function scopeSuffix(options: InsightOptions): string {
  if (options.scope === "HOME") return " at home";
  if (options.scope === "AWAY") return " away from home";
  if (options.scope === "COMPETITION") return ` in the ${options.leagueName ?? "competition"}`;
  return "";
}

type Test = (own: number, against: number) => boolean;

const STREAKS: Array<[InsightType, Test, (n: string) => string]> = [
  ["WIN_STREAK", (a, b) => a > b, (n) => `Won ${n} matches in a row`],
  ["UNBEATEN_STREAK", (a, b) => a >= b, (n) => `Unbeaten in ${n} matches`],
  ["LOSS_STREAK", (a, b) => a < b, (n) => `Lost ${n} matches in a row`],
  ["WINLESS_STREAK", (a, b) => a <= b, (n) => `Without a win in ${n} matches`],
];

const FREQUENCIES: Array<[InsightType, Test, string]> = [
  ["OVER_25", (a, b) => a + b > 2, "Over 2.5 goals"],
  ["BTTS", (a, b) => a > 0 && b > 0, "Both teams scored"],
  ["SCORED_2", (a) => a >= 2, "Scored 2+ goals"],
  ["CLEAN_SHEET", (_a, b) => b === 0, "Kept a clean sheet"],
  ["FAILED_TO_SCORE", (a) => a === 0, "Failed to score"],
];

export function calculateInsights(input: unknown, options: InsightOptions): InsightEvidence[] {
  const history = verifiedHistory(input, options);
  if (history.length < MIN_SAMPLE) return [];

  const suffix = scopeSuffix(options);
  const base = {
    scope: options.scope,
    teamApiId: options.teamApiId,
    teamName: options.teamName,
    leagueApiId: options.scope === "COMPETITION" ? options.leagueApiId ?? null : null,
    leagueName: options.scope === "COMPETITION" ? options.leagueName ?? null : null,
    calculationVersion: INSIGHT_VERSION,
  };
  const out: InsightEvidence[] = [];

  const streakCounts = new Map<InsightType, { count: number; exact: boolean }>();
  for (const [type, test, phrase] of STREAKS) {
    const broken = history.findIndex((m) => !test(m.own, m.against));
    const count = broken === -1 ? history.length : broken;
    const exact = broken !== -1;
    streakCounts.set(type, { count, exact });
    if (count < MIN_STREAK) continue;
    // "Unbeaten in 6" beside "Won 6 in a row" says nothing new; the same holds
    // for winless beside losing. Only the stronger statement is kept.
    const stronger = type === "UNBEATEN_STREAK" ? streakCounts.get("WIN_STREAK") : type === "WINLESS_STREAK" ? streakCounts.get("LOSS_STREAK") : undefined;
    if (stronger && stronger.count === count && stronger.exact === exact) continue;

    const n = exact ? String(count) : `at least ${count}`;
    const sentence = phrase(n) + suffix + ".";
    out.push({
      ...base,
      type,
      count,
      sampleSize: count,
      exact,
      matches: [...history.slice(0, count).map((m) => toMatch(m)), ...(exact ? [toMatch(history[count], true)] : [])],
      explanation: sentence[0].toUpperCase() + sentence.slice(1),
      strength: Math.min(1, count / FREQUENCY_WINDOW),
    });
  }

  const window = history.slice(0, FREQUENCY_WINDOW);
  for (const [type, test, phrase] of FREQUENCIES) {
    const hits = window.filter((m) => test(m.own, m.against)).length;
    if (hits < Math.ceil(window.length * MIN_FREQUENCY)) continue;
    out.push({
      ...base,
      type,
      count: hits,
      sampleSize: window.length,
      exact: true,
      matches: window.map((m) => toMatch(m)),
      explanation: `${phrase} in ${hits} of the last ${window.length} matches${suffix}.`,
      strength: hits / window.length,
    });
  }

  return out;
}
