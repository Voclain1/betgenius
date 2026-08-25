/**
 * API-Football (api-sports.io) client.
 * Docs: https://www.api-football.com/documentation-v3
 *
 * Requires: API_FOOTBALL_KEY, API_FOOTBALL_HOST env vars.
 * Falls back to empty arrays if not configured (so dev mode still renders).
 */

import { hasBudget, recordCall, DAILY_LIMIT, RESERVE } from "@/lib/football/usage";

const HOST = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
const KEY = process.env.API_FOOTBALL_KEY || "";
const BASE = `https://${HOST}`;

export { MAJOR_LEAGUES } from "@/lib/leagues";

// The API-Football Pro plan is capped at 300 requests/minute (and 7,500/day).
// A single prediction generation can fire ~10 calls (team search, stats,
// injuries, form, standings, h2h), so bulk-generating still needs pacing:
// exceeding the cap makes calls fail closed (apiFetch -> null), which surfaces
// as "no fixtures found" / "bulk generate isn't working" rather than an error.
// Serializing every call here with a small gap keeps the whole app under the cap.
const MIN_GAP_MS = 250; // 240 req/min, safely under the 300/min cap
let requestQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function throttle(): Promise<void> {
  const next = requestQueue.then(async () => {
    const wait = Math.max(0, lastRequestAt + MIN_GAP_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  requestQueue = next.catch(() => {});
  return next;
}

async function apiFetch<T = any>(path: string, params: Record<string, string | number> = {}): Promise<T | null> {
  if (!KEY) {
    console.warn("[api-football] Missing API_FOOTBALL_KEY — returning null");
    return null;
  }
  // Daily budget gate. Deliberately checked before the throttle: once the day's
  // quota is gone there's nothing to pace, and callers shouldn't sit through a
  // queue wait only to be refused. Returns null like every other failure path,
  // so existing callers degrade the same way they already do for a rate limit —
  // but the log line names the cause, since "no fixtures found" is otherwise
  // indistinguishable from a quota wall (see MIN_GAP_MS's comment above).
  if (!(await hasBudget())) {
    console.error(`[api-football] Daily quota exhausted (limit ${DAILY_LIMIT}, reserve ${RESERVE}) — refusing ${path}`);
    return null;
  }
  await throttle();
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  // Recorded before awaiting the response: the account is charged the moment
  // the request is dispatched, so counting on success only would under-count
  // exactly the timeouts and 429s that matter most for staying under the cap.
  await recordCall(path);

  const res = await fetch(url.toString(), {
    headers: { "x-apisports-key": KEY },
    next: { revalidate: 60 }, // 1-minute cache on the edge
  });
  if (!res.ok) {
    console.error("[api-football]", res.status, await res.text());
    return null;
  }
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    console.error("[api-football] API error:", JSON.stringify(json.errors));
    return null;
  }
  return json.response as T;
}

export type AccountStatus = {
  account: { firstname?: string; lastname?: string; email?: string };
  subscription: { plan: string; end: string; active: boolean };
  requests: { current: number; limit_day: number };
};

/**
 * Account/plan/quota probe. Deliberately bypasses apiFetch: /status is the one
 * endpoint that must stay reachable *after* the daily budget is spent, since
 * it's what tells us how much was really spent. It's also excluded from
 * recordCall — api-football does not bill /status against the daily quota, and
 * counting it would make the tracker drift up against its own reconciliation.
 *
 * Still passes through throttle() — the per-minute rate limit does apply here.
 */
export async function getAccountStatus(): Promise<AccountStatus | null> {
  if (!KEY) return null;
  await throttle();
  const res = await fetch(`${BASE}/status`, {
    headers: { "x-apisports-key": KEY },
    cache: "no-store", // a cached quota reading is worse than none
  });
  if (!res.ok) {
    console.error("[api-football] /status", res.status, await res.text());
    return null;
  }
  const json = await res.json();
  // Suspended/invalid keys return errors as an object here (an empty array when
  // healthy), with `response` empty — see the suspended-account case.
  if (json.errors && !Array.isArray(json.errors) && Object.keys(json.errors).length > 0) {
    console.error("[api-football] /status error:", JSON.stringify(json.errors));
    return null;
  }
  return (json.response as AccountStatus) ?? null;
}

export type FixtureRow = {
  // `referee` and `venue.city` are returned by /fixtures on every plan and are
  // what FixtureDetailCache stores — they aren't on Prediction and have no
  // other source in the app.
  fixture: {
    id: number;
    date: string;
    status: { short: string; elapsed?: number | null };
    venue?: { id?: number | null; name?: string | null; city?: string | null };
    referee?: string | null;
  };
  league: { id: number; name: string; country: string; logo?: string; season: number; round?: string | null };
  teams: {
    home: { id: number; name: string; logo?: string };
    away: { id: number; name: string; logo?: string };
  };
  goals: { home: number | null; away: number | null };
  score?: {
    halftime?: { home: number | null; away: number | null } | null;
    /** Regulation-time score for settlement; extra time and shootout are separate. */
    fulltime?: { home: number | null; away: number | null } | null;
    extratime?: { home: number | null; away: number | null } | null;
    penalty?: { home: number | null; away: number | null } | null;
  };
};

export function getFixturesByDate(date: string) {
  return apiFetch<FixtureRow[]>("/fixtures", { date });
}

export function getLiveFixtures() {
  return apiFetch<FixtureRow[]>("/fixtures", { live: "all" });
}

export function getFixturesByLeague(leagueId: number, season: number, from?: string, to?: string) {
  const params: Record<string, string | number> = { league: leagueId, season };
  if (from) params.from = from;
  if (to) params.to = to;
  return apiFetch<FixtureRow[]>("/fixtures", params);
}

type LeagueSeason = { year: number; start: string; end: string; current: boolean };
const seasonMetaCache = new Map<number, LeagueSeason[]>();

/**
 * API-Football's `season` param is the year a season STARTED, not the calendar
 * year of the match — e.g. a February 2026 Premier League fixture is season
 * 2025 (started Aug 2025), not 2026. Resolve it from the league's real season
 * date ranges instead of guessing from the date, and cache per league since
 * this rarely changes and every avoided call matters under a 10 req/min cap.
 */
export async function resolveSeason(leagueId: number, date: Date): Promise<number> {
  let seasons = seasonMetaCache.get(leagueId);
  if (!seasons) {
    const raw = await apiFetch<Array<{ seasons: LeagueSeason[] }>>("/leagues", { id: leagueId });
    seasons = raw?.[0]?.seasons ?? [];
    seasonMetaCache.set(leagueId, seasons);
  }

  const iso = date.toISOString().slice(0, 10);
  const inRange = seasons.find((s) => s.start <= iso && iso <= s.end);
  if (inRange) return inRange.year;

  // Off-season gap (e.g. summer break between two seasons) — fall back to
  // whichever season the API currently flags as current, else a heuristic.
  const current = seasons.find((s) => s.current);
  if (current) return current.year;
  return date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

/** Played/won/drawn/lost + goals, as /standings reports it for each of the all/home/away splits. */
export type StandingsSplit = { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };

/**
 * One team's row within a league's standings table.
 *
 * `home`/`away` are returned by /standings on every plan alongside `all` — the
 * Home/Away views on the league page are a re-read of the same response, not a
 * second request.
 */
export type StandingsEntry = {
  rank: number;
  team: { id: number; name: string; logo?: string };
  points: number;
  goalsDiff: number;
  form?: string;
  /**
   * The zone this position sits in, as the API labels it — e.g. "Promotion -
   * Champions League (League phase)", "Relegation". Returned on every plan and
   * verified against the live endpoint. Null for mid-table rows, which is
   * itself meaningful: no label means nothing is at stake at that position.
   */
  description?: string | null;
  all: StandingsSplit;
  home?: StandingsSplit;
  away?: StandingsSplit;
};

export type StandingRow = {
  league: {
    standings: StandingsEntry[][];
  };
};

export async function getStandings(leagueId: number, season: number) {
  const raw = await apiFetch<StandingRow[]>("/standings", { league: leagueId, season });
  if (!raw?.[0]) return null;
  return raw[0].league.standings[0];
}

/**
 * Resolve a team's API-Football id from its name. The /teams search endpoint
 * rejects `search` combined with `league`/`season` ("cannot be used with the
 * Search field"), so there's nothing to scope it by — results are disambiguated
 * by name-closeness instead, deprioritizing youth/reserve/women's sides that
 * often share a substring with the senior team's name (e.g. "Luton" also
 * matching "Luton Town U21").
 */
export type TeamSearchResult = { id: number; name: string; confident: boolean };

const junkPattern = /\b(u1\d|u2[0-3]|w|women|reserves?|ii)\b/i;

/**
 * Rank one result set against the originally-typed name. Scoring always
 * measures against what the caller actually typed, even when the query that
 * produced these results was a shortened variant — the confidence bar belongs
 * to the caller's input, not to whatever query happened to find a hit.
 */
function pickBest(raw: Array<{ team: { id: number; name: string } }>, typedName: string): TeamSearchResult | null {
  if (!raw.length) return null;
  const normalized = typedName.trim().toLowerCase();

  // A lone result used to be trusted unconditionally, which is exactly how
  // "Tottenham Hotspur" became the women's side: the senior team is listed as
  // "Tottenham", so searching the full name returned only junk, and a single
  // junk result was taken as confident. Junk never earns confidence now,
  // however few alternatives came back.
  if (raw.length === 1) {
    const only = raw[0].team;
    return { id: only.id, name: only.name, confident: !junkPattern.test(only.name) };
  }

  const scored = raw.map((r) => {
    const rn = r.team.name.trim().toLowerCase();
    let score = 0;
    if (rn === normalized) score += 100;
    else if (rn.startsWith(normalized) || normalized.startsWith(rn)) score += 50;
    if (junkPattern.test(r.team.name)) score -= 200;
    return { id: r.team.id, name: r.team.name, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return { id: best.id, name: best.name, confident: best.score >= 50 };
}

/**
 * Typed name -> the name api-football actually stores, for teams where the two
 * share no common prefix and so can't be bridged by the queryVariants retry.
 * "Athletic Bilbao" is the motivating case: the API lists it as "Athletic
 * Club", which scores 0 against the typed name and is correctly rejected as
 * low-confidence — a safe failure, but one that never self-corrects.
 *
 * Keys are lowercased/trimmed for lookup. Add entries as similar cases surface;
 * this is deliberately a plain map rather than anything cleverer, since the
 * long tail here is small and each entry is a human judgement call.
 */
const TEAM_NAME_ALIASES: Record<string, string> = {
  "athletic bilbao": "Athletic Club",
};

/**
 * Queries to try, in order. api-football's `search` matches substrings of the
 * stored name, so a longer typed name than the API's own can never match:
 * "Tottenham Hotspur" cannot find "Tottenham", and "Inter Milan" cannot find
 * "Inter". Dropping the trailing word covers that whole class — the common
 * pattern is a suffix the API omits (Hotspur, Milan, United).
 *
 * Bounded at one retry on purpose: each variant costs an API call against the
 * daily quota, and progressively truncating to a single word mostly produces
 * broad, low-quality result sets that the confidence bar rejects anyway.
 */
function queryVariants(name: string): string[] {
  const trimmed = name.trim();
  const words = trimmed.split(/\s+/);
  if (words.length < 2) return [trimmed];
  return [trimmed, words.slice(0, -1).join(" ")];
}

/**
 * Resolve a team's API-Football id from its name. The /teams search endpoint
 * rejects `search` combined with `league`/`season` ("cannot be used with the
 * Search field"), so there's nothing to scope it by — results are disambiguated
 * by name-closeness instead, deprioritizing youth/reserve/women's sides that
 * often share a substring with the senior team's name (e.g. "Luton" also
 * matching "Luton Town U21").
 *
 * `confident` is true when the match is unambiguous enough to act on — see
 * generateAndPersistPrediction, which writes BOTH the resolved team id and the
 * API's spelling of the name only when confident. An unconfident result is
 * returned for logging/debugging but must not be persisted: a wrong-but-
 * plausible id silently attaches another team's stats, form and fixtures to a
 * prediction, which is worse than having no id at all.
 */
export async function searchTeam(name: string): Promise<TeamSearchResult | null> {
  // An alias replaces the typed name as the scoring baseline too, not just as
  // the query — scoring an aliased search against the original text would
  // reject the very match the alias exists to find ("Athletic Club" scores 0
  // against "Athletic Bilbao").
  const target = TEAM_NAME_ALIASES[name.trim().toLowerCase()] ?? name;
  let firstAttempt: TeamSearchResult | null = null;

  for (const query of queryVariants(target)) {
    const raw = await apiFetch<Array<{ team: { id: number; name: string } }>>("/teams", { search: query });
    const best = pickBest(raw ?? [], target);
    if (best?.confident) return best;
    firstAttempt ??= best;
  }

  // Nothing confident anywhere. Returning the unconfident best (rather than
  // null) keeps it visible to callers that log resolution attempts; callers
  // are responsible for not persisting it.
  return firstAttempt;
}

/**
 * Crest lookup by id. searchTeam() (name-based, used at generation time) never
 * captures a logo; this id-based lookup backs the enrichment cache refresh
 * (src/lib/enrichment.ts), which always has an already-resolved team id.
 */
export type TeamVenue = { name: string | null; city: string | null; address: string | null; capacity: number | null };

export async function getTeamById(
  teamId: number,
): Promise<{ id: number; name: string; logo: string | null; venue: TeamVenue | null } | null> {
  const raw = await apiFetch<
    Array<{
      team: { id: number; name: string; logo?: string };
      venue?: { name?: string | null; city?: string | null; address?: string | null; capacity?: number | null };
    }>
  >("/teams", { id: teamId });
  if (!raw?.[0]) return null;
  const v = raw[0].venue;
  return {
    id: raw[0].team.id,
    name: raw[0].team.name,
    logo: raw[0].team.logo ?? null,
    // The venue object is returned alongside `team` on this same response —
    // verified against the live endpoint — so storing it costs nothing extra.
    venue: v ? { name: v.name ?? null, city: v.city ?? null, address: v.address ?? null, capacity: v.capacity ?? null } : null,
  };
}

/** Team & fixture "form" input for the AI prompt. */
export async function getTeamContext(teamId: number, leagueId: number, season: number) {
  const [statistics, injuries, lastFixtures] = await Promise.all([
    apiFetch("/teams/statistics", { team: teamId, league: leagueId, season }),
    apiFetch("/injuries", { team: teamId, season }),
    apiFetch<FixtureRow[]>("/fixtures", { team: teamId, last: 5 }),
  ]);
  return { statistics, injuries, lastFixtures };
}

/**
 * One entry from the /players/top* family. All of them share this shape — the
 * endpoint only decides the ordering, so each response carries the player's
 * full stat line regardless of which leaderboard was asked for.
 *
 * That's why there's no getTopRedCards below: the yellow-card response already
 * carries each player's red count, so a separate call would buy only a
 * differently-ordered version of data we already hold.
 */
export type PlayerStatEntry = {
  player: { id: number; name: string; photo?: string | null };
  statistics: Array<{
    team: { id: number; name: string; logo?: string | null };
    games: { appearences: number | null; minutes: number | null; position?: string | null };
    goals: { total: number | null; assists: number | null };
    cards: { yellow: number | null; yellowred: number | null; red: number | null };
  }>;
};

/**
 * League leaderboards. Verified against the live API on this plan for every
 * league we track: HTTP 200 with no errors, and full 20-row payloads for a
 * completed season. Current-season responses can be empty (season not started,
 * or cards not yet populated) or degenerate for smaller leagues — see
 * trimPlayerStats in src/lib/enrichment.ts for how those are handled.
 */
export function getTopScorers(leagueId: number, season: number) {
  return apiFetch<PlayerStatEntry[]>("/players/topscorers", { league: leagueId, season });
}

export function getTopAssists(leagueId: number, season: number) {
  return apiFetch<PlayerStatEntry[]>("/players/topassists", { league: leagueId, season });
}

export function getTopYellowCards(leagueId: number, season: number) {
  return apiFetch<PlayerStatEntry[]>("/players/topyellowcards", { league: leagueId, season });
}

export type SquadEntry = { id: number; name: string; age?: number | null; number?: number | null; position?: string | null; photo?: string | null };

/** /players/squads returns one wrapper per team, with the squad under `players`. */
export function getSquad(teamId: number) {
  return apiFetch<Array<{ team: { id: number; name: string }; players: SquadEntry[] }>>("/players/squads", { team: teamId });
}

/**
 * /coachs?team= returns EVERY coach associated with the team, historic ones
 * included — not just the incumbent. Callers must resolve the current one from
 * the career spells (see resolveCurrentCoach in src/lib/enrichment.ts);
 * indexing [0] returns e.g. Ljungberg for Arsenal and Xavi for Barcelona.
 */
export type CoachEntry = {
  id: number;
  name: string;
  nationality?: string | null;
  career?: Array<{ team?: { id?: number | null; name?: string | null } | null; start?: string | null; end?: string | null }> | null;
};

export function getCoaches(teamId: number) {
  return apiFetch<CoachEntry[]>("/coachs", { team: teamId });
}

/** Last meetings between two teams, for head-to-head context in the AI prompt. */
export function getHeadToHead(homeTeamId: number, awayTeamId: number, last = 10) {
  return apiFetch<FixtureRow[]>("/fixtures/headtohead", { h2h: `${homeTeamId}-${awayTeamId}`, last });
}

/**
 * Pre-match bookmaker odds for one fixture.
 *
 * The response nests bookmaker -> bet (market) -> values (selections), and is
 * large: ~2,500 prices across 300+ markets for a well-covered fixture. Callers
 * are expected to trim it immediately (see trimOdds in src/lib/odds.ts) rather
 * than store or pass it around whole.
 *
 * Verified against the live API on this plan for every competition in
 * LEAGUE_PRIORITY_ORDER — see scripts/research-odds-coverage.ts. Two findings
 * from that research matter to callers:
 *
 *   - Coverage is a LEAD-TIME property, not a league property. Every tracked
 *     competition carries odds, including the smallest; fixtures inside 72h of
 *     kickoff returned prices 100% of the time, fixtures beyond 7 days only
 *     13%. An empty response for a distant fixture is normal, not a fault.
 *   - `update` is the API's own timestamp for the quote. It is the only
 *     staleness signal available, and prices are shown to readers, so it is
 *     stored and displayed rather than discarded.
 */
export type OddsValue = { value: string; odd: string };
export type OddsBet = { id: number; name: string; values: OddsValue[] };
export type OddsBookmaker = { id: number; name: string; bets: OddsBet[] };
export type OddsResponse = {
  fixture: { id: number; date?: string };
  league?: { id: number; season: number };
  update?: string;
  bookmakers: OddsBookmaker[];
};

export function getOdds(fixtureId: number) {
  return apiFetch<OddsResponse[]>("/odds", { fixture: fixtureId });
}
