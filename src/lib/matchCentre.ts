/**
 * Match Centre statistics (Sprint 02): form, goals, head-to-head, table
 * context, match state and the completed-match record.
 *
 * Pure — no database, no network, no React — so every number can be asserted
 * against hand-built fixtures (scripts/check-match-centre.ts). The page reads
 * the cron-filled caches and hands the raw rows here; nothing on a page view
 * calls the football API.
 *
 * Rules every statistic follows (see docs/sprints/sprint-02-match-centre.md):
 * - Source matches come from verifiedHistory() in src/lib/insights.ts, the
 *   same filter Match Insights uses: regulation-time scores, friendlies
 *   excluded, unplayed fixtures skipped, de-duplicated by provider fixture id,
 *   cut at the first completed match whose score cannot be verified, and only
 *   matches that kicked off before THIS fixture (form "going into" the match,
 *   for a finished fixture too).
 * - A rate is always a count over a sample ({ n, d }). The page prints both.
 *   A missing value is null, never 0.
 * - Fewer matches than the window asked for are shown as what they are; a
 *   sequence is never padded.
 * - These are historical observations. Nothing here is a probability.
 */
import { verifiedHistory, type InsightScope } from "@/lib/insights";
import { classifyStatus, isIrregular, statusLabel } from "@/lib/matchStatus";
import type { H2HMeeting } from "@/lib/h2h";
import type { LeagueStandingRow } from "@/lib/enrichment";

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

/** n of d. `d` is always the real sample size. */
export type Rate = { n: number; d: number };

export function rate(n: number, d: number): Rate | null {
  return d > 0 ? { n, d } : null;
}

/** Whole-number percentage, or null with no sample. */
export function pct(r: Rate | null): number | null {
  return r ? Math.round((r.n / r.d) * 100) : null;
}

/** "7 of 10 · 70%" — the one format every rate is printed in. */
export function formatRate(r: Rate | null): string {
  return r ? `${r.n} of ${r.d} · ${pct(r)}%` : "—";
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// Form and goals for one team
// ---------------------------------------------------------------------------

export const FORM_WINDOWS = [5, 10] as const;
export type FormWindow = (typeof FORM_WINDOWS)[number];

/** ALL = every competitive match; VENUE = this team's home (or away) matches only; COMPETITION = this fixture's competition only. */
export type FormScope = "ALL" | "VENUE" | "COMPETITION";
export const FORM_SCOPES: readonly FormScope[] = ["ALL", "VENUE", "COMPETITION"];

export type FormMatch = {
  fixtureApiId: number;
  date: string;
  opponent: string;
  opponentApiId: number;
  venue: "home" | "away";
  goalsFor: number;
  goalsAgainst: number;
  result: "W" | "D" | "L";
  competition: string;
  competitionApiId: number;
};

export type FormSummary = {
  teamApiId: number;
  scope: FormScope;
  /** The window asked for. `played` may be smaller — the history ran out. */
  window: FormWindow;
  played: number;
  matches: FormMatch[];
  /** Oldest and newest match dates in the sample (ISO), null with no sample. */
  from: string | null;
  to: string | null;
  competitions: string[];
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  avgFor: number | null;
  avgAgainst: number | null;
  avgTotal: number | null;
  winRate: Rate | null;
  cleanSheets: Rate | null;
  failedToScore: Rate | null;
  btts: Rate | null;
  over05: Rate | null;
  over15: Rate | null;
  over25: Rate | null;
  over35: Rate | null;
  /** Points per game on 3/1/0, regulation time. */
  ppg: number | null;
};

type FormInput = {
  history: unknown;
  teamApiId: number;
  teamName: string;
  /** This team's side in the fixture being viewed — decides what VENUE means. */
  side: "home" | "away";
  scope: FormScope;
  window: FormWindow;
  cutoff: Date;
  leagueApiId?: number | null;
  leagueName?: string | null;
};

/** The verified source matches for one team, scope and window, newest first. */
export function formMatches(input: FormInput): FormMatch[] {
  const insightScope: InsightScope =
    input.scope === "ALL" ? "ALL" : input.scope === "COMPETITION" ? "COMPETITION" : input.side === "home" ? "HOME" : "AWAY";
  return verifiedHistory(input.history, {
    teamApiId: input.teamApiId,
    teamName: input.teamName,
    scope: insightScope,
    leagueApiId: input.leagueApiId ?? null,
    leagueName: input.leagueName ?? null,
    cutoff: input.cutoff,
  })
    .slice(0, input.window)
    .map((v) => ({
      fixtureApiId: v.fixture.id,
      date: v.fixture.date,
      opponent: v.venue === "home" ? v.fixture.awayName : v.fixture.homeName,
      opponentApiId: v.venue === "home" ? v.fixture.awayId : v.fixture.homeId,
      venue: v.venue,
      goalsFor: v.own,
      goalsAgainst: v.against,
      result: v.own > v.against ? "W" : v.own === v.against ? "D" : "L",
      competition: v.fixture.leagueName,
      competitionApiId: v.fixture.leagueId,
    }));
}

/** Every figure for one sample of already-verified matches (newest first). Pure arithmetic; no filtering. */
export function summarizeForm(source: readonly FormMatch[], meta: { teamApiId: number; scope: FormScope; window: FormWindow }): FormSummary {
  const matches = source.slice(0, meta.window);
  const d = matches.length;
  const count = (test: (m: FormMatch) => boolean) => matches.filter(test).length;
  const gf = matches.reduce((s, m) => s + m.goalsFor, 0);
  const ga = matches.reduce((s, m) => s + m.goalsAgainst, 0);
  const wins = count((m) => m.result === "W");
  const draws = count((m) => m.result === "D");
  const total = (m: FormMatch) => m.goalsFor + m.goalsAgainst;

  return {
    teamApiId: meta.teamApiId,
    scope: meta.scope,
    window: meta.window,
    played: d,
    matches,
    from: d ? matches[d - 1].date : null,
    to: d ? matches[0].date : null,
    competitions: Array.from(new Set(matches.map((m) => m.competition))),
    wins,
    draws,
    losses: d - wins - draws,
    goalsFor: gf,
    goalsAgainst: ga,
    avgFor: d ? round2(gf / d) : null,
    avgAgainst: d ? round2(ga / d) : null,
    avgTotal: d ? round2((gf + ga) / d) : null,
    winRate: rate(wins, d),
    cleanSheets: rate(count((m) => m.goalsAgainst === 0), d),
    failedToScore: rate(count((m) => m.goalsFor === 0), d),
    btts: rate(count((m) => m.goalsFor > 0 && m.goalsAgainst > 0), d),
    over05: rate(count((m) => total(m) > 0.5), d),
    over15: rate(count((m) => total(m) > 1.5), d),
    over25: rate(count((m) => total(m) > 2.5), d),
    over35: rate(count((m) => total(m) > 3.5), d),
    ppg: d ? round2((wins * 3 + draws) / d) : null,
  };
}

export function formSummary(input: FormInput): FormSummary {
  return summarizeForm(formMatches(input), { teamApiId: input.teamApiId, scope: input.scope, window: input.window });
}

/**
 * What the page sends to the browser: for each scope, each team's verified
 * matches for the LARGEST window only (≤ 10 rows). Every smaller window is a
 * prefix of it, so the component derives last-5 with summarizeForm instead of
 * the server serialising both — about half the payload of a full grid.
 */
export type FormSource = Record<FormScope, { home: FormMatch[]; away: FormMatch[] }>;

export function formSource(input: {
  homeHistory: unknown;
  awayHistory: unknown;
  homeTeamApiId: number;
  awayTeamApiId: number;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  leagueApiId: number | null;
  leagueName: string | null;
}): FormSource {
  const max = FORM_WINDOWS[FORM_WINDOWS.length - 1];
  const out = {} as FormSource;
  for (const scope of FORM_SCOPES) {
    const common = { scope, window: max, cutoff: input.kickoff, leagueApiId: input.leagueApiId, leagueName: input.leagueName };
    out[scope] = {
      home: formMatches({ ...common, history: input.homeHistory, teamApiId: input.homeTeamApiId, teamName: input.homeTeam, side: "home" }),
      away: formMatches({ ...common, history: input.awayHistory, teamApiId: input.awayTeamApiId, teamName: input.awayTeam, side: "away" }),
    };
  }
  return out;
}

export function hasAnyFormSource(src: FormSource): boolean {
  return src.ALL.home.length > 0 || src.ALL.away.length > 0;
}

/** Every window × scope for both teams — at most 12 passes over ≤ 20 rows, computed once per render. */
export type FormGrid = Record<FormScope, Record<FormWindow, { home: FormSummary; away: FormSummary }>>;

export function formGrid(input: {
  homeHistory: unknown;
  awayHistory: unknown;
  homeTeamApiId: number;
  awayTeamApiId: number;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  leagueApiId: number | null;
  leagueName: string | null;
}): FormGrid {
  const grid = {} as FormGrid;
  for (const scope of FORM_SCOPES) {
    grid[scope] = {} as FormGrid[FormScope];
    for (const window of FORM_WINDOWS) {
      const common = { scope, window, cutoff: input.kickoff, leagueApiId: input.leagueApiId, leagueName: input.leagueName };
      grid[scope][window] = {
        home: formSummary({ ...common, history: input.homeHistory, teamApiId: input.homeTeamApiId, teamName: input.homeTeam, side: "home" }),
        away: formSummary({ ...common, history: input.awayHistory, teamApiId: input.awayTeamApiId, teamName: input.awayTeam, side: "away" }),
      };
    }
  }
  return grid;
}

export function hasAnyForm(grid: FormGrid): boolean {
  return grid.ALL[10].home.played > 0 || grid.ALL[10].away.played > 0;
}

/** Plain-language description of a sample — printed beside every comparison. */
export function scopeDescription(scope: FormScope, side: "home" | "away", leagueName: string | null): string {
  if (scope === "VENUE") return side === "home" ? "home matches only" : "away matches only";
  if (scope === "COMPETITION") return leagueName ? `${leagueName} only` : "this competition only";
  return "all competitions";
}

// ---------------------------------------------------------------------------
// Side-by-side comparison
// ---------------------------------------------------------------------------

export type ComparisonValue =
  | { kind: "rate"; rate: Rate | null }
  | { kind: "avg"; value: number | null }
  | { kind: "record"; w: number; d: number; l: number; played: number };

export type ComparisonRow = {
  key: string;
  label: string;
  home: ComparisonValue;
  away: ComparisonValue;
  /** 0-1 bar widths; null when a side has no value. */
  homeBar: number | null;
  awayBar: number | null;
};

function bars(home: ComparisonValue, away: ComparisonValue): [number | null, number | null] {
  if (home.kind === "rate" && away.kind === "rate") {
    return [home.rate ? home.rate.n / home.rate.d : null, away.rate ? away.rate.n / away.rate.d : null];
  }
  if (home.kind === "avg" && away.kind === "avg") {
    // Scaled to the larger of the two (minimum one goal), so a 0.4 vs 0.2
    // comparison does not draw two near-full bars.
    const scale = Math.max(1, home.value ?? 0, away.value ?? 0);
    return [home.value == null ? null : home.value / scale, away.value == null ? null : away.value / scale];
  }
  if (home.kind === "record" && away.kind === "record") {
    // Share of available points taken (3 per win, 1 per draw).
    const share = (r: { w: number; d: number; played: number }) => (r.played ? (r.w * 3 + r.d) / (r.played * 3) : null);
    return [share(home), share(away)];
  }
  return [null, null];
}

export function comparisonRows(home: FormSummary, away: FormSummary): ComparisonRow[] {
  const rows: Array<Omit<ComparisonRow, "homeBar" | "awayBar">> = [
    { key: "record", label: "W-D-L", home: { kind: "record", w: home.wins, d: home.draws, l: home.losses, played: home.played }, away: { kind: "record", w: away.wins, d: away.draws, l: away.losses, played: away.played } },
    { key: "scored", label: "Scored per match", home: { kind: "avg", value: home.avgFor }, away: { kind: "avg", value: away.avgFor } },
    { key: "conceded", label: "Conceded per match", home: { kind: "avg", value: home.avgAgainst }, away: { kind: "avg", value: away.avgAgainst } },
    { key: "cleanSheets", label: "Clean sheets", home: { kind: "rate", rate: home.cleanSheets }, away: { kind: "rate", rate: away.cleanSheets } },
    { key: "failedToScore", label: "Failed to score", home: { kind: "rate", rate: home.failedToScore }, away: { kind: "rate", rate: away.failedToScore } },
    { key: "btts", label: "Both teams scored", home: { kind: "rate", rate: home.btts }, away: { kind: "rate", rate: away.btts } },
    { key: "over05", label: "Over 0.5 goals", home: { kind: "rate", rate: home.over05 }, away: { kind: "rate", rate: away.over05 } },
    { key: "over15", label: "Over 1.5 goals", home: { kind: "rate", rate: home.over15 }, away: { kind: "rate", rate: away.over15 } },
    { key: "over25", label: "Over 2.5 goals", home: { kind: "rate", rate: home.over25 }, away: { kind: "rate", rate: away.over25 } },
    { key: "over35", label: "Over 3.5 goals", home: { kind: "rate", rate: home.over35 }, away: { kind: "rate", rate: away.over35 } },
  ];
  return rows.map((r) => {
    const [homeBar, awayBar] = bars(r.home, r.away);
    return { ...r, homeBar, awayBar };
  });
}

export function formatComparisonValue(v: ComparisonValue): string {
  if (v.kind === "rate") return formatRate(v.rate);
  if (v.kind === "avg") return v.value == null ? "—" : v.value.toFixed(2);
  return v.played ? `${v.w}-${v.d}-${v.l}` : "—";
}

// ---------------------------------------------------------------------------
// Goal thresholds table (Over 0.5 … 3.5)
// ---------------------------------------------------------------------------

export const GOAL_LINES = [
  { key: "over05", label: "Over 0.5" },
  { key: "over15", label: "Over 1.5" },
  { key: "over25", label: "Over 2.5" },
  { key: "over35", label: "Over 3.5" },
] as const;

// ---------------------------------------------------------------------------
// Head-to-head
// ---------------------------------------------------------------------------

export const H2H_WINDOWS = [5, 10] as const;
export type H2HWindow = (typeof H2H_WINDOWS)[number];

export type H2HWindowStats = {
  window: H2HWindow;
  played: number;
  meetings: H2HMeeting[];
  from: string | null;
  to: string | null;
  homeWins: number;
  awayWins: number;
  draws: number;
  /** Goals by each of TODAY's sides, wherever the meeting was played. */
  homeGoals: number;
  awayGoals: number;
  /** Today's home side's record when it hosted the meeting, and when it travelled. */
  homeAsHost: { w: number; d: number; l: number };
  homeAsVisitor: { w: number; d: number; l: number };
  btts: Rate | null;
  over25: Rate | null;
  avgGoals: number | null;
};

/**
 * One window of meetings between today's two sides. Meetings are de-duplicated
 * by provider fixture id (the cache can hold one twice after a rescheduled
 * refresh), must involve exactly these two teams, must have kicked off before
 * `cutoff`, and are ordered newest first.
 */
export function h2hWindow(meetings: readonly H2HMeeting[], homeTeamApiId: number, awayTeamApiId: number, window: H2HWindow, cutoff: Date): H2HWindowStats {
  const pair = new Set([homeTeamApiId, awayTeamApiId]);
  const byId = new Map<number, H2HMeeting>();
  for (const m of meetings) {
    if (!pair.has(m.homeTeamApiId) || !pair.has(m.awayTeamApiId) || m.homeTeamApiId === m.awayTeamApiId) continue;
    if (!Number.isInteger(m.homeGoals) || !Number.isInteger(m.awayGoals) || m.homeGoals < 0 || m.awayGoals < 0) continue;
    const t = Date.parse(m.date);
    if (!Number.isFinite(t) || t >= cutoff.getTime()) continue;
    byId.set(m.fixtureApiId, m);
  }
  const list = [...byId.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, window);
  const d = list.length;
  let homeWins = 0, awayWins = 0, draws = 0, homeGoals = 0, awayGoals = 0;
  const homeAsHost = { w: 0, d: 0, l: 0 };
  const homeAsVisitor = { w: 0, d: 0, l: 0 };
  for (const m of list) {
    const ourHomeHosted = m.homeTeamApiId === homeTeamApiId;
    const ours = ourHomeHosted ? m.homeGoals : m.awayGoals;
    const theirs = ourHomeHosted ? m.awayGoals : m.homeGoals;
    homeGoals += ours;
    awayGoals += theirs;
    const bucket = ourHomeHosted ? homeAsHost : homeAsVisitor;
    if (ours > theirs) { homeWins++; bucket.w++; }
    else if (ours < theirs) { awayWins++; bucket.l++; }
    else { draws++; bucket.d++; }
  }
  return {
    window,
    played: d,
    meetings: list,
    from: d ? list[d - 1].date : null,
    to: d ? list[0].date : null,
    homeWins,
    awayWins,
    draws,
    homeGoals,
    awayGoals,
    homeAsHost,
    homeAsVisitor,
    btts: rate(list.filter((m) => m.homeGoals > 0 && m.awayGoals > 0).length, d),
    over25: rate(list.filter((m) => m.homeGoals + m.awayGoals > 2.5).length, d),
    avgGoals: d ? round2((homeGoals + awayGoals) / d) : null,
  };
}

// ---------------------------------------------------------------------------
// Table context
// ---------------------------------------------------------------------------

export type TableSide = {
  row: LeagueStandingRow;
  goalDifference: number;
  /** This team's record at the venue it plays today, when the table carries splits. */
  venueRecord: { label: "Home" | "Away"; played: number; w: number; d: number; l: number; gf: number; ga: number } | null;
};

export type TableContext =
  | { kind: "none"; reason: "no-table" | "teams-missing" | "not-started" }
  | {
      kind: "table";
      /** True when the table holds several groups (duplicate ranks) — neighbours and gaps are then not meaningful. */
      grouped: boolean;
      home: TableSide;
      away: TableSide;
      /** home points minus away points. */
      pointsGap: number;
      /** Places between them (absolute), null for a grouped table. */
      placesApart: number | null;
    };

/**
 * Both teams' rows from the cached table OF THIS FIXTURE'S COMPETITION. The
 * caller passes the LeagueEnrichmentCache row for the match's own leagueApiId
 * — a table is never borrowed from another competition — and anything that
 * does not contain both teams is reported as such rather than half-shown.
 */
export function tableContext(standings: readonly LeagueStandingRow[] | null | undefined, homeTeamApiId: number | null, awayTeamApiId: number | null): TableContext {
  if (!standings?.length) return { kind: "none", reason: "no-table" };
  const home = standings.find((r) => r.teamId === homeTeamApiId);
  const away = standings.find((r) => r.teamId === awayTeamApiId);
  if (!home || !away || homeTeamApiId == null || awayTeamApiId == null) return { kind: "none", reason: "teams-missing" };
  if (home.played === 0 && away.played === 0) return { kind: "none", reason: "not-started" };
  const ranks = standings.map((r) => r.rank);
  const grouped = new Set(ranks).size !== ranks.length;
  const side = (row: LeagueStandingRow, at: "home" | "away"): TableSide => {
    const split = at === "home" ? row.home : row.away;
    return {
      row,
      goalDifference: row.goalsFor - row.goalsAgainst,
      venueRecord:
        split && Number.isInteger(split.played)
          ? { label: at === "home" ? "Home" : "Away", played: split.played, w: split.win, d: split.draw, l: split.loss, gf: split.goalsFor, ga: split.goalsAgainst }
          : null,
    };
  };
  return {
    kind: "table",
    grouped,
    home: side(home, "home"),
    away: side(away, "away"),
    pointsGap: home.points - away.points,
    placesApart: grouped ? null : Math.abs(home.rank - away.rank),
  };
}

/** "Arsenal are 3 points and 2 places ahead of Chelsea." — arithmetic only; never what the gap means for qualification or relegation. */
export function tableSentence(ctx: TableContext, homeTeam: string, awayTeam: string): string | null {
  if (ctx.kind !== "table") return null;
  const { pointsGap, placesApart } = ctx;
  const leader = pointsGap > 0 || (pointsGap === 0 && ctx.home.row.rank < ctx.away.row.rank) ? homeTeam : awayTeam;
  const trailer = leader === homeTeam ? awayTeam : homeTeam;
  const pts = Math.abs(pointsGap);
  if (ctx.grouped) return pts === 0 ? `${homeTeam} and ${awayTeam} are level on points.` : `${leader} have ${pts} more point${pts === 1 ? "" : "s"} than ${trailer}.`;
  if (pts === 0) return `${homeTeam} and ${awayTeam} are level on ${ctx.home.row.points} points, ${placesApart} place${placesApart === 1 ? "" : "s"} apart.`;
  return `${leader} are ${pts} point${pts === 1 ? "" : "s"} and ${placesApart} place${placesApart === 1 ? "" : "s"} ahead of ${trailer}.`;
}

// ---------------------------------------------------------------------------
// Match state
// ---------------------------------------------------------------------------

export type MatchState = "scheduled" | "live" | "finished" | "postponed" | "cancelled" | "abandoned" | "awarded" | "suspended" | "unknown";

const IRREGULAR_STATE: Record<string, MatchState> = { PST: "postponed", CANC: "cancelled", ABD: "abandoned", AWD: "awarded", WO: "awarded", SUSP: "suspended", INT: "suspended" };

/**
 * What the page may say about the fixture. A provider status code, when we
 * hold one, decides it — a stored final score alone never makes a postponed
 * or abandoned fixture "finished". Without a code, a settled final score
 * means finished, a future kickoff means scheduled, and a past kickoff with
 * nothing else is "unknown" rather than a guess at live.
 */
export function matchState(input: { statusShort?: string | null; finalScore?: { home: number; away: number } | null; kickoff: Date; now?: Date }): MatchState {
  const code = input.statusShort ?? null;
  if (code) {
    if (IRREGULAR_STATE[code]) return IRREGULAR_STATE[code];
    if (isIrregular(code)) return "cancelled";
    const group = classifyStatus(code);
    if (group === "live") return "live";
    if (group === "upcoming") return (input.now ?? new Date()) < input.kickoff ? "scheduled" : "unknown";
    return "finished";
  }
  if (input.finalScore) return "finished";
  return (input.now ?? new Date()) < input.kickoff ? "scheduled" : "unknown";
}

export const MATCH_STATE_LABEL: Record<MatchState, string> = {
  scheduled: "Scheduled",
  live: "In play",
  finished: "Full time",
  postponed: "Postponed",
  cancelled: "Cancelled",
  abandoned: "Abandoned",
  awarded: "Result awarded",
  suspended: "Suspended",
  unknown: "Result pending",
};

// ---------------------------------------------------------------------------
// Completed-match record (stored in FixtureDetailCache.detailJson.result)
// ---------------------------------------------------------------------------

export type ScorePair = { home: number; away: number };

export type MatchEvent = {
  minute: number;
  extra: number | null;
  teamApiId: number;
  kind: "goal" | "own-goal" | "penalty-goal" | "missed-penalty" | "red-card" | "second-yellow" | "yellow-card" | "substitution" | "var";
  player: string | null;
  /** Assist for a goal; the player coming ON for a substitution. */
  related: string | null;
  detail: string | null;
};

export type MatchStatLine = { type: string; home: string | number | null; away: string | number | null };

export type FixtureResult = {
  fixtureApiId: number;
  status: string;
  elapsed: number | null;
  halftime: ScorePair | null;
  fulltime: ScorePair | null;
  extratime: ScorePair | null;
  penalty: ScorePair | null;
  events: MatchEvent[] | null;
  statistics: MatchStatLine[] | null;
  /** ISO time this snapshot was taken from the provider response. */
  capturedAt: string;
};

const isNonNegInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;

function pair(raw: unknown): ScorePair | null {
  const p = raw as { home?: unknown; away?: unknown } | null | undefined;
  return p && isNonNegInt(p.home) && isNonNegInt(p.away) ? { home: p.home, away: p.away } : null;
}

const STAT_TYPES = ["Ball Possession", "Total Shots", "Shots on Goal", "Corner Kicks", "Fouls", "Offsides", "Yellow Cards", "Red Cards", "Goalkeeper Saves", "expected_goals"] as const;

function eventKind(type: string, detail: string): MatchEvent["kind"] | null {
  const t = type.toLowerCase();
  const d = detail.toLowerCase();
  if (t === "goal") {
    if (d.includes("own")) return "own-goal";
    if (d.includes("missed")) return "missed-penalty";
    if (d.includes("penalty")) return "penalty-goal";
    return "goal";
  }
  if (t === "card") {
    if (d.includes("second")) return "second-yellow";
    if (d.includes("red")) return "red-card";
    if (d.includes("yellow")) return "yellow-card";
    return null;
  }
  if (t === "subst") return "substitution";
  if (t === "var") return "var";
  return null;
}

/**
 * Reduce one raw api-football fixture object to the stored record. Returns
 * null unless the object carries a provider id and a status — anything less
 * cannot be attributed to a fixture. Events and statistics are included only
 * when the response actually carried them (an id lookup does; the date slate
 * does not), each item validated; a malformed item is dropped, never guessed.
 */
export function compactFixtureResult(raw: unknown, capturedAt: Date): FixtureResult | null {
  const r = raw as {
    fixture?: { id?: unknown; status?: { short?: unknown; elapsed?: unknown } };
    teams?: { home?: { id?: unknown }; away?: { id?: unknown } };
    score?: { halftime?: unknown; fulltime?: unknown; extratime?: unknown; penalty?: unknown };
    events?: unknown;
    statistics?: unknown;
  } | null;
  const id = r?.fixture?.id;
  const status = r?.fixture?.status?.short;
  if (!isNonNegInt(id) || typeof status !== "string" || !status) return null;
  const homeId = r?.teams?.home?.id;
  const awayId = r?.teams?.away?.id;

  let events: MatchEvent[] | null = null;
  if (Array.isArray(r?.events)) {
    events = [];
    for (const e of r!.events as Array<Record<string, any>>) {
      const minute = e?.time?.elapsed;
      const teamApiId = e?.team?.id;
      if (!isNonNegInt(minute) || (teamApiId !== homeId && teamApiId !== awayId) || !isNonNegInt(teamApiId)) continue;
      const kind = eventKind(String(e?.type ?? ""), String(e?.detail ?? ""));
      if (!kind) continue;
      events.push({
        minute,
        extra: isNonNegInt(e?.time?.extra) ? e.time.extra : null,
        teamApiId,
        kind,
        player: typeof e?.player?.name === "string" && e.player.name.trim() ? e.player.name.trim() : null,
        related: typeof e?.assist?.name === "string" && e.assist.name.trim() ? e.assist.name.trim() : null,
        detail: typeof e?.detail === "string" ? e.detail : null,
      });
    }
    events.sort((a, b) => a.minute - b.minute || (a.extra ?? 0) - (b.extra ?? 0));
  }

  let statistics: MatchStatLine[] | null = null;
  if (Array.isArray(r?.statistics) && r!.statistics.length === 2) {
    const [a, b] = r!.statistics as Array<{ team?: { id?: unknown }; statistics?: Array<{ type?: unknown; value?: unknown }> }>;
    const homeBlock = a?.team?.id === homeId ? a : b?.team?.id === homeId ? b : null;
    const awayBlock = homeBlock === a ? b : a;
    if (homeBlock && awayBlock?.team?.id === awayId) {
      const val = (block: typeof a, type: string) => {
        const v = block?.statistics?.find((s) => s?.type === type)?.value;
        return typeof v === "number" || (typeof v === "string" && v.length <= 12) ? v : null;
      };
      statistics = STAT_TYPES.map((type) => ({ type, home: val(homeBlock, type), away: val(awayBlock, type) })).filter((s) => s.home != null || s.away != null);
    }
  }

  return {
    fixtureApiId: id,
    status,
    elapsed: isNonNegInt(r?.fixture?.status?.elapsed) ? (r!.fixture!.status!.elapsed as number) : null,
    halftime: pair(r?.score?.halftime),
    fulltime: pair(r?.score?.fulltime),
    extratime: pair(r?.score?.extratime),
    penalty: pair(r?.score?.penalty),
    events,
    statistics,
    capturedAt: capturedAt.toISOString(),
  };
}

/** Validates a stored record read back from JSON; anything malformed is treated as absent. */
export function readFixtureResult(raw: unknown, fixtureApiId: number | null): FixtureResult | null {
  const r = raw as FixtureResult | null;
  if (!r || typeof r !== "object" || !isNonNegInt(r.fixtureApiId) || typeof r.status !== "string" || typeof r.capturedAt !== "string") return null;
  // A record for a different fixture (a rescheduled match re-resolved to a new
  // id) describes another game and is ignored.
  if (fixtureApiId != null && r.fixtureApiId !== fixtureApiId) return null;
  return r;
}

/** Merge rule: a newer status never erases events/statistics a previous, richer capture stored. */
export function mergeFixtureResult(prev: FixtureResult | null, next: FixtureResult): FixtureResult {
  if (!prev || prev.fixtureApiId !== next.fixtureApiId) return next;
  return { ...next, events: next.events ?? prev.events, statistics: next.statistics ?? prev.statistics, halftime: next.halftime ?? prev.halftime };
}

export const EVENT_LABEL: Record<MatchEvent["kind"], string> = {
  goal: "Goal",
  "own-goal": "Own goal",
  "penalty-goal": "Penalty",
  "missed-penalty": "Missed penalty",
  "red-card": "Red card",
  "second-yellow": "Second yellow",
  "yellow-card": "Yellow card",
  substitution: "Substitution",
  var: "VAR",
};

export function minuteLabel(e: Pick<MatchEvent, "minute" | "extra">): string {
  return e.extra ? `${e.minute}+${e.extra}'` : `${e.minute}'`;
}

/** Status words for a result line: "Full time", "After extra time", "Won on penalties 4-3". */
export function resultLabel(r: FixtureResult): string {
  if (r.status === "AET") return "After extra time";
  if (r.status === "PEN") return r.penalty ? `Penalties ${r.penalty.home}-${r.penalty.away}` : "Decided on penalties";
  return statusLabel(r.status) === "FT" ? "Full time" : statusLabel(r.status);
}
