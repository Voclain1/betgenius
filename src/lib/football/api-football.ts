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
  fixture: { id: number; date: string; status: { short: string; elapsed?: number | null }; venue?: { name?: string } };
  league: { id: number; name: string; country: string; logo?: string; season: number };
  teams: {
    home: { id: number; name: string; logo?: string };
    away: { id: number; name: string; logo?: string };
  };
  goals: { home: number | null; away: number | null };
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

/** One team's row within a league's standings table. */
export type StandingsEntry = {
  rank: number;
  team: { id: number; name: string; logo?: string };
  points: number;
  goalsDiff: number;
  form?: string;
  all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
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
export async function getTeamById(teamId: number): Promise<{ id: number; name: string; logo: string | null } | null> {
  const raw = await apiFetch<Array<{ team: { id: number; name: string; logo?: string } }>>("/teams", { id: teamId });
  if (!raw?.[0]) return null;
  return { id: raw[0].team.id, name: raw[0].team.name, logo: raw[0].team.logo ?? null };
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

/** Last meetings between two teams, for head-to-head context in the AI prompt. */
export function getHeadToHead(homeTeamId: number, awayTeamId: number, last = 10) {
  return apiFetch<FixtureRow[]>("/fixtures/headtohead", { h2h: `${homeTeamId}-${awayTeamId}`, last });
}

