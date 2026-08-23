/**
 * The football evidence for one fixture, projected from raw api-football
 * responses into the compact shape the model is actually prompted with.
 *
 * Why this exists: the raw payloads for a mid-season fixture measure ~155KB
 * compact and ~253KB pretty-printed (~65k tokens) — verified against live
 * Allsvenskan responses, not estimated. Most of that is neither predictive nor
 * even correct as presented:
 *
 *   - /injuries returns one record per (player, fixture) for the WHOLE season,
 *     duplicated within each fixture date: 139 records covering 21 distinct
 *     players, dating back to April. Passed raw, the model reads a player who
 *     missed one game in April as unavailable today. Trimming to the most
 *     recent matchday's deduped set is both ~100x smaller AND more accurate.
 *   - Every entity carries logo/photo/flag CDN URLs and repeats the full league
 *     object on every row.
 *   - The standings table ships all 16-20 rows when only two teams are playing.
 *
 * So this is not primarily a cost optimisation that trades away accuracy — the
 * two biggest reductions (injuries, standings) remove material that was
 * actively misleading or irrelevant. Fields with genuine predictive value are
 * kept and in several cases NEWLY surfaced: home/away splits, goal averages,
 * clean sheets, failed-to-score, formations and discipline totals were all
 * present in the raw payload but buried where the model rarely used them.
 *
 * Pure functions over raw responses — no I/O, no database, no api-football
 * client. Same posture as trimH2H/trimSquad/trimPlayerStats in
 * src/lib/enrichment.ts, and for the same reason: the trimming rules are the
 * part worth checking in isolation.
 */

import type { FixtureRow, StandingsEntry } from "@/lib/football/api-football";
import { trimH2H, computeH2HStats, type H2HMeeting, type H2HStats } from "@/lib/h2h";

/** Played/won/drawn/lost + goals for one split (overall, home, or away). */
export type RecordSplit = { played: number; win: number; draw: number; loss: number; goalsFor: number; goalsAgainst: number };

/** Per-split rate, as api-football reports it for goal averages / clean sheets / failed-to-score. */
export type Split3 = { total: number | null; home: number | null; away: number | null };

/**
 * One unavailable player for the upcoming match.
 *
 * `kind` is derived from api-football's free-text `reason`, because a
 * suspension and a hamstring tear are the same record type upstream ("Missing
 * Fixture") but mean different things to a reader and to a prediction: a
 * suspension is certain and time-boxed, an injury is neither.
 */
export type AvailabilityEntry = { player: string; reason: string; kind: "injury" | "suspension" | "unavailable" };

/** A league leaderboard entry for one of this fixture's teams, when already cached. */
export type KeyPlayer = { name: string; goals?: number | null; assists?: number | null };

export type TeamDigest = {
  name: string;
  apiId: number | null;
  /** League position, when standings resolved. */
  rank: number | null;
  points: number | null;
  /** Season record — overall plus the home/away splits, which the raw payload has but the old prompt buried. */
  overall: RecordSplit | null;
  home: RecordSplit | null;
  away: RecordSplit | null;
  /** Goals per game, split by venue. Numbers here — api-football sends these as strings. */
  goalsForAvg: Split3 | null;
  goalsAgainstAvg: Split3 | null;
  cleanSheets: Split3 | null;
  failedToScore: Split3 | null;
  /** Result string, most recent last, e.g. "DWWLWLLLLWWWDLWLW". */
  form: string | null;
  /** Longest runs this season. */
  streak: { wins: number; draws: number; losses: number } | null;
  /** Heaviest results this season, as scorelines — narrative-useful and tiny. */
  biggest: { winHome: string | null; winAway: string | null; loseHome: string | null; loseAway: string | null } | null;
  /** Formations actually used, most-played first — the only tactical signal in the payload. */
  formations: Array<{ formation: string; played: number }>;
  /** Discipline totals. Per-minute buckets are dropped; only the totals carry. */
  cards: { yellow: number; red: number } | null;
  penalties: { scored: number; missed: number } | null;
  /** Last 5 matches, all competitions. */
  last5: Array<{ opponent: string; venue: "home" | "away"; result: string; goalsFor: number | null; goalsAgainst: number | null; date: string }>;
  /** Deduped unavailable players for the NEXT match — see selectCurrentAvailability. */
  availability: AvailabilityEntry[];
  /** Matchday the availability list was read from, so staleness is visible rather than implied. */
  availabilityAsOf: string | null;
  /** Top scorers/assisters from the league leaderboard, when the enrichment cache already holds them. Never fetched for this. */
  keyPlayers: KeyPlayer[];
};

/**
 * One row of the table near a fixture team. `isFixtureTeam` marks the two sides
 * actually playing, so the model can see the gap between them and their
 * neighbours without matching names back to the fixture header.
 */
export type StandingsNeighbour = {
  rank: number;
  team: string;
  points: number;
  played: number;
  goalDiff: number;
  /** The API's own zone label ("Relegation", "Promotion - Champions League"), when the position carries one. */
  zone?: string | null;
  isFixtureTeam?: true;
};

export type StandingsContext = {
  totalTeams: number;
  /** Points of the first and last placed teams — enough to locate the two teams in the table without shipping it. */
  leaderPoints: number | null;
  bottomPoints: number | null;
  /** League-wide goals per game, computed across every row. Anchors any over/under call. */
  avgGoalsPerGame: number | null;
  /**
   * The rows immediately around each fixture team, merged and deduped — what a
   * title race or a relegation scrap actually looks like from where these two
   * sit. Empty when neither team could be located in the table.
   */
  neighbourhood: StandingsNeighbour[];
};

/**
 * Rows kept either side of each fixture team.
 *
 * Three is the smallest window that still shows a scrap rather than a pair: it
 * covers the teams a side is realistically catching or being caught by, and at
 * ~45 bytes a row two full windows cost well under 1KB even when the two teams
 * sit at opposite ends of the table. The full table this replaces measured
 * 7.7–9.6KB in the live responses.
 */
const NEIGHBOUR_RADIUS = 3;

export type MatchDigest = {
  v: 2;
  fixture: {
    home: string;
    away: string;
    league: string;
    kickoff: string;
    competitionType?: "CUP" | "LEAGUE";
    round?: string | null;
  };
  teams: { home: TeamDigest; away: TeamDigest };
  h2h: { meetings: H2HMeeting[]; stats: H2HStats } | null;
  standings: StandingsContext | null;
  /**
   * Which parts resolved. Lets the prompt say "you have no injury data" instead
   * of the model inferring an empty list means a fully fit squad — the single
   * most likely hallucination this whole module is guarding against.
   */
  coverage: { stats: boolean; form: boolean; availability: boolean; h2h: boolean; standings: boolean };
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

function split3(node: any): Split3 | null {
  if (!node) return null;
  const s = { total: num(node.total), home: num(node.home), away: num(node.away) };
  return s.total === null && s.home === null && s.away === null ? null : s;
}

function recordSplit(fixtures: any, goals: any, key: "home" | "away" | "total"): RecordSplit | null {
  const played = num(fixtures?.played?.[key]);
  if (played === null) return null;
  return {
    played,
    win: num(fixtures?.wins?.[key]) ?? 0,
    draw: num(fixtures?.draws?.[key]) ?? 0,
    loss: num(fixtures?.loses?.[key]) ?? 0,
    goalsFor: num(goals?.for?.total?.[key]) ?? 0,
    goalsAgainst: num(goals?.against?.total?.[key]) ?? 0,
  };
}

/**
 * Classify api-football's free-text absence reason.
 *
 * "Yellow Cards"/"Red Card" are suspensions — certain, and resolved by serving
 * them. "Inactive"/"Not in squad" mean the player simply isn't being selected,
 * which is not an injury and shouldn't be written up as one. Everything else
 * ("Knee Injury", "Groin Injury", bare "Injury") is a fitness absence.
 */
export function classifyAbsence(reason: string | null | undefined): AvailabilityEntry["kind"] {
  const r = (reason ?? "").toLowerCase();
  if (/card|suspend|ban\b/.test(r)) return "suspension";
  if (/inactive|not in squad|rest|personal|national|coach|illness/.test(r)) return "unavailable";
  return "injury";
}

/**
 * The current unavailable list, out of a season's worth of absence records.
 *
 * api-football's /injuries returns one row per (player, fixture) for the entire
 * season, and repeats each row within a matchday — a live Allsvenskan response
 * held 139 rows covering 21 distinct players, with 22 rows on the latest date
 * for 11 players. Taking the latest fixture date and deduping by player is what
 * turns that into "who is out for the next game".
 *
 * Deliberately NOT a rolling window: an absence record belongs to a specific
 * fixture, so a player who returned three games ago still has April rows. Only
 * the most recent matchday describes the present.
 */
export function selectCurrentAvailability(raw: unknown): { entries: AvailabilityEntry[]; asOf: string | null } {
  const rows = Array.isArray(raw) ? raw : [];
  if (rows.length === 0) return { entries: [], asOf: null };

  let latest = "";
  for (const r of rows) {
    const d = (r as any)?.fixture?.date;
    if (typeof d === "string" && d > latest) latest = d;
  }
  if (!latest) return { entries: [], asOf: null };
  const latestDay = latest.slice(0, 10);

  const byPlayer = new Map<string, AvailabilityEntry>();
  for (const r of rows) {
    const row = r as any;
    if (!row?.fixture?.date?.startsWith(latestDay)) continue;
    const name = row?.player?.name;
    if (typeof name !== "string" || !name) continue;
    if (byPlayer.has(name)) continue;
    const reason = typeof row?.player?.reason === "string" ? row.player.reason : "Unknown";
    byPlayer.set(name, { player: name, reason, kind: classifyAbsence(reason) });
  }

  return { entries: [...byPlayer.values()], asOf: latestDay };
}

/** Last-5 form, from the same /fixtures?last=5 response the enrichment cache trims. */
function trimLast5(teamApiId: number | null, fixtures: FixtureRow[] | null | undefined): TeamDigest["last5"] {
  if (!fixtures?.length || teamApiId == null) return [];
  return fixtures.slice(0, 5).map((f) => {
    const isHome = f.teams.home.id === teamApiId;
    const own = isHome ? f.goals.home : f.goals.away;
    const opp = isHome ? f.goals.away : f.goals.home;
    return {
      opponent: isHome ? f.teams.away.name : f.teams.home.name,
      venue: (isHome ? "home" : "away") as "home" | "away",
      result: own == null || opp == null ? "?" : own > opp ? "W" : own < opp ? "L" : "D",
      goalsFor: own ?? null,
      goalsAgainst: opp ?? null,
      date: f.fixture.date.slice(0, 10),
    };
  });
}

function scoreline(node: any): string | null {
  return typeof node === "string" && node.trim() ? node.trim() : null;
}

export type TeamDigestInput = {
  name: string;
  apiId: number | null;
  /** Raw /teams/statistics response. */
  statistics?: unknown;
  /** Raw /injuries response. */
  injuries?: unknown;
  /** Raw /fixtures?last=5 response. */
  lastFixtures?: FixtureRow[] | null;
  /** This team's row from /standings, already located by the caller. */
  standingsRow?: StandingsEntry | null;
  /** Already-cached league leaderboard entries for this team, if any. Never fetched on this path. */
  keyPlayers?: KeyPlayer[];
};

export function buildTeamDigest(input: TeamDigestInput): TeamDigest {
  const st = (input.statistics ?? null) as any;
  const availability = selectCurrentAvailability(input.injuries);
  const row = input.standingsRow ?? null;

  const cardTotal = (node: any): number => {
    if (!node) return 0;
    return Object.values(node).reduce<number>((sum, bucket: any) => sum + (num(bucket?.total) ?? 0), 0);
  };

  // Before a ball is kicked, /teams/statistics returns a fully-populated object
  // of ZEROS — played 0, goals average "0.0", clean sheets 0 — and /standings
  // returns an alphabetically-ordered table where everyone has 0 points. Passed
  // through, that reads to the model as fact: a side that averages no goals and
  // sits top of the league. Both are artefacts of an unplayed season, so every
  // season-derived field is suppressed until there is at least one match behind
  // it, and coverage.stats goes false. The last-5 (which spans the previous
  // season) still carries real evidence, which is exactly what should drive an
  // opening-weekend prediction.
  const seasonPlayed = num(st?.fixtures?.played?.total) ?? row?.all?.played ?? 0;
  const hasSeasonStats = seasonPlayed > 0;
  const tablePlayed = row?.all?.played ?? 0;

  return {
    name: input.name,
    apiId: input.apiId,
    rank: tablePlayed > 0 ? (row?.rank ?? null) : null,
    points: tablePlayed > 0 ? (row?.points ?? null) : null,
    // Prefer the statistics payload for the record splits; fall back to the
    // standings row, which carries the same overall/home/away shape and is
    // present even when /teams/statistics comes back empty.
    overall: hasSeasonStats ? (recordSplit(st?.fixtures, st?.goals, "total") ?? fromStandingsSplit(row?.all)) : null,
    home: hasSeasonStats ? (recordSplit(st?.fixtures, st?.goals, "home") ?? fromStandingsSplit(row?.home)) : null,
    away: hasSeasonStats ? (recordSplit(st?.fixtures, st?.goals, "away") ?? fromStandingsSplit(row?.away)) : null,
    goalsForAvg: hasSeasonStats ? split3(st?.goals?.for?.average) : null,
    goalsAgainstAvg: hasSeasonStats ? split3(st?.goals?.against?.average) : null,
    cleanSheets: hasSeasonStats ? split3(st?.clean_sheet) : null,
    failedToScore: hasSeasonStats ? split3(st?.failed_to_score) : null,
    form: (typeof st?.form === "string" && st.form) || row?.form || null,
    streak: hasSeasonStats && st?.biggest?.streak
      ? { wins: num(st.biggest.streak.wins) ?? 0, draws: num(st.biggest.streak.draws) ?? 0, losses: num(st.biggest.streak.loses) ?? 0 }
      : null,
    biggest: hasSeasonStats && st?.biggest
      ? {
          winHome: scoreline(st.biggest.wins?.home),
          winAway: scoreline(st.biggest.wins?.away),
          loseHome: scoreline(st.biggest.loses?.home),
          loseAway: scoreline(st.biggest.loses?.away),
        }
      : null,
    formations: Array.isArray(st?.lineups)
      ? st.lineups
          .filter((l: any) => typeof l?.formation === "string")
          .slice(0, 4)
          .map((l: any) => ({ formation: l.formation, played: num(l.played) ?? 0 }))
      : [],
    cards: hasSeasonStats && st?.cards ? { yellow: cardTotal(st.cards.yellow), red: cardTotal(st.cards.red) } : null,
    penalties: hasSeasonStats && st?.penalty ? { scored: num(st.penalty.scored?.total) ?? 0, missed: num(st.penalty.missed?.total) ?? 0 } : null,
    last5: trimLast5(input.apiId, input.lastFixtures),
    availability: availability.entries,
    availabilityAsOf: availability.asOf,
    keyPlayers: input.keyPlayers ?? [],
  };
}

function fromStandingsSplit(s: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } } | undefined | null): RecordSplit | null {
  if (!s) return null;
  return { played: s.played, win: s.win, draw: s.draw, loss: s.lose, goalsFor: s.goals.for, goalsAgainst: s.goals.against };
}

/**
 * League-level context, from the standings table that is otherwise dropped.
 *
 * The full table is ~8KB of rows for teams not playing in this fixture. What
 * actually informs a prediction is where these two sit and what a normal
 * scoreline looks like in this league — four numbers instead of twenty rows.
 */
export function buildStandingsContext(
  standings: StandingsEntry[] | null | undefined,
  fixtureTeamIds: Array<number | null> = [],
): StandingsContext | null {
  if (!standings?.length) return null;
  const ranked = [...standings].sort((a, b) => a.rank - b.rank);
  const totalPlayed = standings.reduce((n, r) => n + (r.all?.played ?? 0), 0);
  const totalGoals = standings.reduce((n, r) => n + (r.all?.goals?.for ?? 0), 0);
  // A table before the first matchday is an alphabetical list on zero points —
  // it describes nothing, so it is absent rather than reported as flat.
  if (totalPlayed === 0) return null;

  // Union of the windows around each fixture team, by INDEX in the ranked list
  // rather than by rank arithmetic — ranks can tie or skip in some competitions,
  // so slicing positions is the only ordering that always holds. Overlapping
  // windows (two mid-table sides three apart) collapse to one contiguous run.
  const ids = new Set(fixtureTeamIds.filter((id): id is number => id != null));
  const keep = new Set<number>();
  ranked.forEach((row, i) => {
    if (!ids.has(row.team?.id)) return;
    // A side that hasn't played yet sits at an alphabetical position on zero
    // points, so the rows around it describe nothing — same artefact the
    // per-team stats guard above handles. Its window is skipped; the other
    // team's (if it has played) is still built.
    if ((row.all?.played ?? 0) === 0) return;
    for (let j = Math.max(0, i - NEIGHBOUR_RADIUS); j <= Math.min(ranked.length - 1, i + NEIGHBOUR_RADIUS); j++) {
      keep.add(j);
    }
  });

  const neighbourhood: StandingsNeighbour[] = [...keep]
    .sort((a, b) => a - b)
    .map((i) => {
      const r = ranked[i];
      const zone = typeof r.description === "string" && r.description.trim() ? r.description.trim() : null;
      return {
        rank: r.rank,
        team: r.team?.name ?? "?",
        points: r.points,
        played: r.all?.played ?? 0,
        goalDiff: r.goalsDiff,
        ...(zone ? { zone } : {}),
        ...(ids.has(r.team?.id) ? { isFixtureTeam: true as const } : {}),
      };
    });

  return {
    totalTeams: standings.length,
    leaderPoints: ranked[0]?.points ?? null,
    bottomPoints: ranked[ranked.length - 1]?.points ?? null,
    // Every goal is one team's `for`, and every match is counted once per side,
    // so total goals / (total played / 2) is goals per match.
    avgGoalsPerGame: totalPlayed > 0 ? Number((totalGoals / (totalPlayed / 2)).toFixed(2)) : null,
    neighbourhood,
  };
}

export type BuildMatchDigestInput = {
  home: string;
  away: string;
  league: string;
  kickoff: string;
  homeApiId: number | null;
  awayApiId: number | null;
  /** Raw getTeamContext() results. */
  homeContext?: { statistics?: unknown; injuries?: unknown; lastFixtures?: FixtureRow[] | null } | null;
  awayContext?: { statistics?: unknown; injuries?: unknown; lastFixtures?: FixtureRow[] | null } | null;
  standings?: StandingsEntry[] | null;
  h2h?: FixtureRow[] | null;
  homeKeyPlayers?: KeyPlayer[];
  awayKeyPlayers?: KeyPlayer[];
};

export function buildMatchDigest(input: BuildMatchDigestInput): MatchDigest {
  const findRow = (apiId: number | null) =>
    apiId == null ? null : (input.standings?.find((r) => r.team?.id === apiId) ?? null);

  const home = buildTeamDigest({
    name: input.home,
    apiId: input.homeApiId,
    statistics: input.homeContext?.statistics,
    injuries: input.homeContext?.injuries,
    lastFixtures: input.homeContext?.lastFixtures,
    standingsRow: findRow(input.homeApiId),
    keyPlayers: input.homeKeyPlayers,
  });
  const away = buildTeamDigest({
    name: input.away,
    apiId: input.awayApiId,
    statistics: input.awayContext?.statistics,
    injuries: input.awayContext?.injuries,
    lastFixtures: input.awayContext?.lastFixtures,
    standingsRow: findRow(input.awayApiId),
    keyPlayers: input.awayKeyPlayers,
  });

  // Reuses the H2H page's own trimming, so the model reasons from the same
  // meetings the reader eventually sees on /predictions/h2h/[slug].
  return assembleMatchDigest({
    fixture: { home: input.home, away: input.away, league: input.league, kickoff: input.kickoff },
    homeTeam: home,
    awayTeam: away,
    homeApiId: input.homeApiId,
    awayApiId: input.awayApiId,
    meetings: trimH2H(input.h2h ?? null),
    standings: buildStandingsContext(input.standings, [input.homeApiId, input.awayApiId]),
  });
}

/**
 * Assemble a digest from parts that are ALREADY projected.
 *
 * Split out of buildMatchDigest so the same assembly serves two sources:
 *
 *   - the raw path above, which projects fresh api-football payloads, and
 *   - the cache path (src/lib/ai/generationContext.ts), which reads
 *     TeamDigests that refreshTeamCache already built and stored.
 *
 * Both produce a byte-identical shape, which is the point: a prediction
 * generated from warm caches and one generated from a live fetch must be the
 * same object, or the stored context stops being a faithful record of what the
 * model saw. Everything version-, coverage- and h2h-related therefore lives
 * here once rather than in each caller.
 */
export function assembleMatchDigest(input: {
  fixture: MatchDigest["fixture"];
  homeTeam: TeamDigest;
  awayTeam: TeamDigest;
  homeApiId: number | null;
  awayApiId: number | null;
  /** Already trimmed to settled meetings — trimH2H on the raw path, the cache's stored list on the other. */
  meetings: H2HMeeting[];
  standings: StandingsContext | null;
}): MatchDigest {
  const { homeTeam: home, awayTeam: away } = input;

  const h2h =
    input.meetings.length > 0 && input.homeApiId != null && input.awayApiId != null
      ? { meetings: input.meetings, stats: computeH2HStats(input.meetings, input.homeApiId, input.awayApiId) }
      : null;

  return {
    v: 2,
    fixture: input.fixture,
    teams: { home, away },
    h2h,
    standings: input.standings,
    coverage: {
      stats: !!(home.overall || away.overall),
      form: home.last5.length > 0 || away.last5.length > 0,
      availability: home.availabilityAsOf !== null || away.availabilityAsOf !== null,
      h2h: h2h !== null,
      standings: input.standings !== null,
    },
  };
}

/**
 * True when the digest carries no real evidence at all — the digest-level
 * equivalent of the old isTeamContextEmpty check in generate.ts, and what
 * Prediction.contextComplete is set from.
 */
export function isDigestEmpty(d: MatchDigest): boolean {
  const c = d.coverage;
  return !c.stats && !c.form && !c.availability && !c.h2h && !c.standings;
}
