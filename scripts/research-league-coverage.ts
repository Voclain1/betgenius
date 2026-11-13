/**
 * Provider probe: what API-Football itself says about Welsh competitions, and
 * which competitions with fixtures in the next two days are not in our
 * catalogue at all.
 *
 *   1. Identity   /leagues?country=Wales: every Welsh competition the provider
 *                 lists, its id, type, current season, season dates and the
 *                 provider's own coverage flags (odds, standings, statistics).
 *   2. Fixtures   per current Welsh competition, one /fixtures call spanning
 *                 the last 30 and next 14 days: scheduled, finished, and the
 *                 share of finished fixtures with full-time and half-time scores.
 *   3. Odds       up to 2 upcoming fixtures per competition: bookmaker count
 *                 and whether 1X2 and over/under are quoted.
 *   4. Uncatalogued  /fixtures?date= for today and tomorrow (UTC): fixtures by
 *                 competition for ids our catalogue does not know, by country.
 *
 * Read-only: no database access, no app state. Spends at most MAX_CALLS
 * provider calls (hard cap), about 0.5% of the 7,500 daily allowance.
 *
 * Run: npx tsx --env-file=.env scripts/research-league-coverage.ts
 */
export {};

import { LEAGUE_CATALOGUE, generationTierOf } from "../src/lib/leagues";
import { MIN_BOOKMAKERS } from "../src/lib/odds";

type Env<T> = { errors: unknown; results: number; response: T };
const host = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
const key = process.env.API_FOOTBALL_KEY;
if (!key) throw new Error("API_FOOTBALL_KEY is not configured");

const MAX_CALLS = 40;
const MIN_GAP_MS = 300;
let calls = 0;
let lastAt = 0;
async function call<T>(path: string, params: Record<string, string | number>): Promise<Env<T> | null> {
  if (calls >= MAX_CALLS) { console.log(`  (call cap ${MAX_CALLS} reached; skipped ${path})`); return null; }
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  calls++;
  const url = new URL(`https://${host}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { "x-apisports-key": key! } });
  if (!res.ok) { console.log(`  ${path} HTTP ${res.status}`); return null; }
  const body = (await res.json()) as Env<T>;
  const errs = body.errors && (Array.isArray(body.errors) ? body.errors.length : Object.keys(body.errors as object).length);
  if (errs) console.log(`  ${path} provider errors: ${JSON.stringify(body.errors)}`);
  return body;
}

type LeagueRow = {
  league: { id: number; name: string; type: string };
  country: { name: string };
  seasons: Array<{ year: number; start: string; end: string; current: boolean; coverage: any }>;
};
type FixtureRow = {
  fixture: { id: number; date: string; status: { short: string } };
  league: { id: number; name: string; country: string; season: number; round?: string };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
  score: { halftime: { home: number | null; away: number | null } };
};
type OddsRow = { bookmakers: Array<{ id: number; bets: Array<{ id: number; name: string }> }> };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function main() {
  const now = new Date();
  const catalogued = new Set<number>(LEAGUE_CATALOGUE.map((l) => l.id));

  console.log("== 1. Welsh competitions listed by the provider ==");
  const leagues = (await call<LeagueRow[]>("/leagues", { country: "Wales" }))?.response ?? [];
  const resolved: Array<Record<string, unknown>> = [];
  for (const l of leagues) {
    const cur = l.seasons.find((s) => s.current) ?? l.seasons.at(-1);
    const cov = cur?.coverage ?? {};
    console.log(`  ${l.league.id} ${l.league.name} [${l.league.type}] season ${cur?.year} ${cur?.start}..${cur?.end} current=${cur?.current}`
      + ` | odds=${cov.odds} standings=${cov.standings} stats=${cov.fixtures?.statistics_fixtures} events=${cov.fixtures?.events} lineups=${cov.fixtures?.lineups}`
      + ` | catalogue=${catalogued.has(l.league.id) ? `yes (${generationTierOf(l.league.id)})` : "NO"}`);
    resolved.push({ id: l.league.id, name: l.league.name, type: l.league.type, season: cur?.year, current: cur?.current, start: cur?.start, end: cur?.end, odds: cov.odds, standings: cov.standings });
  }

  console.log("\n== 2/3. Fixtures and odds, current Welsh competitions ==");
  const from = iso(new Date(now.getTime() - 30 * 86_400_000));
  const to = iso(new Date(now.getTime() + 14 * 86_400_000));
  for (const l of leagues.slice(0, 8)) {
    const cur = l.seasons.find((s) => s.current);
    if (!cur) { console.log(`  ${l.league.id} ${l.league.name}: no current season`); continue; }
    const fx = (await call<FixtureRow[]>("/fixtures", { league: l.league.id, season: cur.year, from, to }))?.response ?? [];
    const upcoming = fx.filter((f) => f.fixture.status.short === "NS" && new Date(f.fixture.date) > now);
    const finished = fx.filter((f) => ["FT", "AET", "PEN"].includes(f.fixture.status.short));
    const ft = finished.filter((f) => f.goals.home != null && f.goals.away != null).length;
    const ht = finished.filter((f) => f.score?.halftime?.home != null && f.score?.halftime?.away != null).length;
    console.log(`  ${l.league.id} ${l.league.name} (${cur.year}): ${upcoming.length} scheduled next 14d, ${finished.length} finished last 30d (FT score ${ft}, HT score ${ht})`);
    for (const f of upcoming.slice(0, 6)) console.log(`     ${f.fixture.date.slice(0, 16)} ${f.teams.home.name} v ${f.teams.away.name} [${f.league.round ?? ""}] fixture ${f.fixture.id}`);
    const counts: number[] = [];
    for (const f of upcoming.slice(0, 2)) {
      const o = (await call<OddsRow[]>("/odds", { fixture: f.fixture.id }))?.response?.[0];
      const books = o?.bookmakers ?? [];
      counts.push(books.length);
      const has = (id: number) => books.filter((b) => b.bets.some((x) => x.id === id)).length;
      console.log(`     odds ${f.fixture.id}: ${books.length} bookmakers; 1X2 quoted by ${has(1)}; over/under by ${has(5)}; clears MIN_BOOKMAKERS(${MIN_BOOKMAKERS}): ${books.length >= MIN_BOOKMAKERS}`);
    }
    if (counts.length) console.log(`     median bookmakers over sampled fixtures: ${median(counts)}`);
  }

  console.log("\n== 4. Competitions with fixtures today/tomorrow (UTC) that the catalogue does not know ==");
  const unknown = new Map<number, { name: string; country: string; n: number }>();
  let total = 0;
  let inCatalogue = 0;
  for (const d of [iso(now), iso(new Date(now.getTime() + 86_400_000))]) {
    const fx = (await call<FixtureRow[]>("/fixtures", { date: d }))?.response ?? [];
    for (const f of fx) {
      total++;
      if (catalogued.has(f.league.id)) { inCatalogue++; continue; }
      const u = unknown.get(f.league.id) ?? { name: f.league.name, country: f.league.country, n: 0 };
      u.n++;
      unknown.set(f.league.id, u);
    }
  }
  console.log(`  ${total} fixtures; ${inCatalogue} in catalogue competitions; ${total - inCatalogue} in ${unknown.size} uncatalogued competitions`);
  for (const [id, u] of [...unknown.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 40)) console.log(`   ${String(id).padStart(5)} ${u.country} — ${u.name}: ${u.n}`);

  console.log(`\nRESOLVED_WELSH_COMPETITIONS=${JSON.stringify(resolved)}`);
  console.log(`provider calls used: ${calls} (cap ${MAX_CALLS})`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
