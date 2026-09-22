/**
 * Research probe: which senior women's competitions does API-Football cover
 * well enough to generate, price and publish?
 *
 * For every current senior women's league/cup the provider lists, and the
 * named targets in particular, measures:
 *   1. Identity      - provider id, name, country, current season, type.
 *   2. Coverage      - the provider's own coverage flags (fixtures, events,
 *                      statistics, lineups, odds, predictions).
 *   3. Fixtures      - scheduled in the next 14 days; finished in the last 30.
 *   4. Data quality  - share of recent finished fixtures with a full-time score
 *                      and a halftime score.
 *   5. Odds depth    - for upcoming fixtures: share with any odds, median /
 *                      min bookmaker count, share clearing MIN_BOOKMAKERS (the
 *                      same bar men's football uses), and whether the 1X2 and
 *                      goals markets are quoted.
 *
 * Read-only. Writes nothing to the database and touches no app code.
 * Run: npx tsx --env-file=.env scripts/research-womens-coverage.ts
 */
export {};

import { MIN_BOOKMAKERS } from "../src/lib/odds";

type ApiEnvelope<T> = { errors: unknown; results: number; response: T; paging?: { current: number; total: number } };

const host = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
const key = process.env.API_FOOTBALL_KEY;
if (!key) throw new Error("API_FOOTBALL_KEY is not configured");

const MIN_GAP_MS = 250;
let lastAt = 0;
let calls = 0;
async function call<T>(path: string, params: Record<string, string | number> = {}): Promise<ApiEnvelope<T>> {
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  calls++;
  const url = new URL(`https://${host}${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const res = await fetch(url, { headers: { "x-apisports-key": key! } });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<ApiEnvelope<T>>;
}

type LeagueRow = {
  league: { id: number; name: string; type: string };
  country: { name: string };
  seasons: Array<{
    year: number; start: string; end: string; current: boolean;
    coverage: { fixtures: { events: boolean; statistics_fixtures: boolean; lineups: boolean }; odds: boolean; predictions: boolean; standings: boolean };
  }>;
};
type Fixture = {
  fixture: { id: number; date: string; status: { short: string } };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
  score: { halftime: { home: number | null; away: number | null } };
};
type OddsRow = { fixture: { id: number }; bookmakers: Array<{ id: number; name: string; bets: Array<{ id: number; name: string }> }> };

/** Women's senior competitions by name; youth/U-age and reserve comps are excluded after. */
const WOMEN = /women|woman|femin|frauen|feminine|féminine|femminile|ladies|damallsvenskan|toppserien|kvindeliga|liga f\b|nwsl|w-league|wsl|vrouwen|eredivisie women|dames|kobiet|ženy|zeny|naisten|kvenna/i;
const NOT_SENIOR = /u-?\d{2}|under|youth|junior|reserve|\bii\b|2\.|second|championship|b junioren|amateur/i;

const TARGETS: Record<string, RegExp> = {
  "UEFA Women's Champions League": /champions league women|uefa champions league women|women.*champions league/i,
  "Women's Super League (England)": /^(fa )?wsl$|women'?s super league/i,
  "Liga F (Spain)": /^liga f$|primera división femenina|primera division women/i,
  "Frauen-Bundesliga (Germany)": /frauen bundesliga|frauen-bundesliga|bundesliga women/i,
  "Première Ligue / D1 (France)": /première ligue|premiere ligue|d1 féminine|feminine division 1|division 1 féminine/i,
  "Serie A Femminile (Italy)": /serie a women|serie a femminile/i,
  "NWSL (USA)": /nwsl/i,
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] : 0);
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");

(async () => {
  const now = new Date();
  const leagues = await call<LeagueRow[]>("/leagues", { current: "true" });
  const candidates = leagues.response.filter((l) => WOMEN.test(l.league.name) && !NOT_SENIOR.test(l.league.name));
  // Target matches by name, and anything with women in the name among the
  // candidates (a country's second tier is reported, flagged, not dropped).
  const target = (l: LeagueRow) => Object.entries(TARGETS).find(([, re]) => re.test(l.league.name) && (/England/.test(l.country.name) || !/wsl|super league/i.test(l.league.name) || true))?.[0] ?? null;

  console.log(`provider lists ${leagues.results} current competitions; ${candidates.length} look like senior women's (${calls} calls so far)\n`);

  const rows: Array<Record<string, string | number>> = [];
  for (const l of candidates) {
    const season = l.seasons.find((s) => s.current) ?? l.seasons[l.seasons.length - 1];
    const cov = season.coverage;
    const ahead = await call<Fixture[]>("/fixtures", { league: l.league.id, season: season.year, from: iso(now), to: iso(new Date(now.getTime() + 14 * 86_400_000)) });
    const behind = await call<Fixture[]>("/fixtures", { league: l.league.id, season: season.year, from: iso(new Date(now.getTime() - 30 * 86_400_000)), to: iso(new Date(now.getTime() - 86_400_000)) });
    const upcoming = ahead.response.filter((f) => f.fixture.status.short === "NS");
    const finished = behind.response.filter((f) => ["FT", "AET", "PEN"].includes(f.fixture.status.short));
    const withScore = finished.filter((f) => f.goals.home != null && f.goals.away != null).length;
    const withHt = finished.filter((f) => f.score.halftime.home != null && f.score.halftime.away != null).length;

    // Odds for the league's upcoming fixtures (the pre-match odds feed, page 1
    // is enough: at most a round or two of fixtures is priced at a time).
    const odds = cov.odds ? await call<OddsRow[]>("/odds", { league: l.league.id, season: season.year }) : { response: [] as OddsRow[] };
    const upcomingIds = new Set(upcoming.map((f) => f.fixture.id));
    const priced = odds.response.filter((o) => upcomingIds.has(o.fixture.id));
    const books = priced.map((o) => o.bookmakers.length);
    const deep = books.filter((b) => b >= MIN_BOOKMAKERS).length;
    const has1x2 = priced.filter((o) => o.bookmakers.some((b) => b.bets.some((x) => x.id === 1))).length;
    const hasGoals = priced.filter((o) => o.bookmakers.some((b) => b.bets.some((x) => x.id === 5))).length;
    const oddsFor = (id: number) => odds.response.find((o) => o.fixture.id === id)?.bookmakers.length ?? 0;
    const sample = upcoming.slice(0, 2).map((f) => `${f.teams.home.name} v ${f.teams.away.name} (${oddsFor(f.fixture.id)}bk)`).join("; ");

    rows.push({
      target: target(l) ?? "",
      id: l.league.id,
      name: l.league.name,
      country: l.country.name,
      type: l.league.type,
      season: season.year,
      cov: [cov.fixtures.events && "ev", cov.fixtures.statistics_fixtures && "st", cov.fixtures.lineups && "lu", cov.odds && "odds", cov.predictions && "pred"].filter(Boolean).join(","),
      next14d: upcoming.length,
      last30d: finished.length,
      ftScore: pct(withScore, finished.length),
      htScore: pct(withHt, finished.length),
      pricedUpcoming: `${priced.length}/${upcoming.length}`,
      medianBooks: median(books),
      minBooks: books.length ? Math.min(...books) : 0,
      maxBooks: books.length ? Math.max(...books) : 0,
      [`>=${MIN_BOOKMAKERS}bk`]: pct(deep, priced.length),
      "1x2": pct(has1x2, priced.length),
      goals: pct(hasGoals, priced.length),
      sample,
    });
  }

  rows.sort((a, b) => Number(!a.target) - Number(!b.target) || Number(b.medianBooks) - Number(a.medianBooks));
  for (const r of rows) console.log(JSON.stringify(r));
  const missing = Object.keys(TARGETS).filter((t) => !rows.some((r) => r.target === t));
  if (missing.length) console.log(`\nTARGETS NOT MATCHED BY NAME: ${missing.join(", ")}`);
  console.log(`\n${calls} provider calls`);
})();
