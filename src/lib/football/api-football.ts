/**
 * API-Football (api-sports.io) client.
 * Docs: https://www.api-football.com/documentation-v3
 *
 * Requires: API_FOOTBALL_KEY, API_FOOTBALL_HOST env vars.
 * Falls back to empty arrays if not configured (so dev mode still renders).
 */

const HOST = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
const KEY = process.env.API_FOOTBALL_KEY || "";
const BASE = `https://${HOST}`;

export { MAJOR_LEAGUES } from "@/lib/leagues";

// The API-Football plan in use here is capped at 10 requests/minute. A single
// prediction generation can fire ~10 calls (team search, stats, injuries, form,
// standings, h2h), so without throttling, bulk-generating more than one fixture
// blows through the cap and calls silently fail closed (apiFetch -> null),
// which looks like "no fixtures found" / "bulk generate isn't working".
// Serializing every call here with a safe gap keeps the whole app under the cap.
const MIN_GAP_MS = 6500; // ~9.2 req/min, safely under the 10/min cap
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
  await throttle();
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

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

export type FixtureRow = {
  fixture: { id: number; date: string; status: { short: string }; venue?: { name?: string } };
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

export type StandingRow = {
  league: {
    standings: Array<
      Array<{
        rank: number;
        team: { id: number; name: string; logo?: string };
        points: number;
        goalsDiff: number;
        form?: string;
        all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
      }>
    >;
  };
};

export async function getStandings(leagueId: number, season: number) {
  const raw = await apiFetch<StandingRow[]>("/standings", { league: leagueId, season });
  if (!raw?.[0]) return null;
  return raw[0].league.standings[0];
}

/** Resolve a team's API-Football id from its name, optionally scoped to a league. */
export async function searchTeam(name: string, leagueId?: number, season?: number) {
  const params: Record<string, string | number> = { search: name };
  if (leagueId) params.league = leagueId;
  if (season) params.season = season;
  const raw = await apiFetch<Array<{ team: { id: number; name: string } }>>("/teams", params);
  return raw?.[0]?.team.id ?? null;
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
