/**
 * Follow-up probe to research-odds-coverage.ts.
 *
 * The first pass could not tell two very different findings apart: a league
 * that api-football has no odds for at all, versus a league whose next fixture
 * is simply too far out for any book to have opened. Every "NO ODDS" league in
 * that pass had its nearest sampled kickoff 95h+ away, so the verdict was
 * confounded.
 *
 * This pass removes the confound by asking about fixtures that have ALREADY
 * been played (odds for those are settled history, so lead time can't be the
 * explanation) and, separately, by measuring what a whole-day /odds sweep
 * actually costs in requests — the number that decides whether caching is done
 * per fixture or per day.
 *
 * Read-only. Run: npx tsx --env-file=.env scripts/research-odds-leadtime.ts
 */
export {};

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

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The leagues the first pass could not clear, plus two controls with known-good coverage. */
const SUSPECTS = [
  { id: 144, name: "Jupiler Pro League (Belgium)", verdict: "NO ODDS" },
  { id: 286, name: "Super Liga (Serbia)", verdict: "NO ODDS" },
  { id: 315, name: "Premijer Liga (Bosnia)", verdict: "NO ODDS" },
  { id: 342, name: "Premier League (Armenia)", verdict: "NO ODDS" },
  { id: 419, name: "Premyer Liqa (Azerbaijan)", verdict: "NO ODDS" },
  { id: 137, name: "Coppa Italia (Italy)", verdict: "NO ODDS" },
  { id: 333, name: "Premier League (Ukraine)", verdict: "THIN" },
  { id: 329, name: "Meistriliiga (Estonia)", verdict: "THIN" },
  { id: 110, name: "Premier League (Wales)", verdict: "THIN" },
  { id: 39, name: "Premier League (England)", verdict: "CONTROL" },
  { id: 140, name: "La Liga (Spain)", verdict: "CONTROL" },
];

async function seasonFor(leagueId: number, now: Date): Promise<number | null> {
  const raw = await call<any[]>("/leagues", { id: leagueId });
  const seasons = raw.response[0]?.seasons ?? [];
  const today = iso(now);
  const s = seasons.find((x: any) => x.start <= today && today <= x.end) ?? seasons.find((x: any) => x.current) ?? seasons.at(-1);
  return s?.year ?? null;
}

function depthOf(entry: any) {
  const bookmakers: any[] = entry?.bookmakers ?? [];
  const markets = new Set(bookmakers.flatMap((b) => (b.bets ?? []).map((bet: any) => bet.name)));
  return { bookmakers: bookmakers.length, markets: markets.size, names: bookmakers.map((b) => b.name).slice(0, 8) };
}

async function main() {
  const now = new Date();

  // --- Part 1: played fixtures. Lead time cannot explain a miss here. ---
  const played: any[] = [];
  for (const league of SUSPECTS) {
    const season = await seasonFor(league.id, now);
    if (season == null) {
      played.push({ ...league, note: "no season metadata" });
      continue;
    }
    const from = iso(new Date(now.getTime() - 21 * 86_400_000));
    const fixtures = await call<any[]>("/fixtures", { league: league.id, season, from, to: iso(now) });
    const finished = (fixtures.response ?? [])
      .filter((f) => ["FT", "AET", "PEN"].includes(f.fixture?.status?.short))
      .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
      .slice(0, 3);

    const samples = [];
    for (const f of finished) {
      const odds = await call<any[]>("/odds", { fixture: f.fixture.id });
      const depth = depthOf(odds.response?.[0]);
      samples.push({
        fixtureId: f.fixture.id,
        label: `${f.teams.home.name} v ${f.teams.away.name}`,
        playedAt: f.fixture.date,
        daysAgo: Number(((now.getTime() - new Date(f.fixture.date).getTime()) / 86_400_000).toFixed(1)),
        ...depth,
      });
    }
    played.push({
      ...league,
      season,
      finishedInWindow: finished.length,
      samples,
      // The whole point of this pass: does this league EVER carry odds?
      historicalOddsExist: samples.some((s) => s.bookmakers > 0),
    });
  }

  // --- Part 2: what a per-day sweep costs, and how deep it is at T-24h. ---
  const tomorrow = iso(new Date(now.getTime() + 86_400_000));
  const day = await call<any[]>("/odds", { date: tomorrow });
  const dayDepths = (day.response ?? []).map((e: any) => ({ fixtureId: e.fixture?.id, ...depthOf(e), update: e.update }));

  // Same day, scoped to one league — the shape a per-league cache refresh takes.
  const eplSeason = await seasonFor(39, now);
  const eplDay = eplSeason ? await call<any[]>("/odds", { league: 39, season: eplSeason }) : null;

  // --- Part 3: how far ahead the endpoint will quote ANY fixture at all. ---
  const horizon: any[] = [];
  for (let offset = 0; offset <= 10; offset++) {
    const date = iso(new Date(now.getTime() + offset * 86_400_000));
    const r = await call<any[]>("/odds", { date });
    horizon.push({ date, daysAhead: offset, fixturesWithOdds: r.results, pages: r.paging?.total ?? null });
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        apiCallsSpent: calls,
        playedFixtureProbe: played,
        perDaySweep: {
          date: tomorrow,
          fixturesWithOdds: day.results,
          pages: day.paging?.total ?? null,
          pageSize: day.response?.length ?? 0,
          sampleDepths: dayDepths.slice(0, 5),
        },
        perLeagueSweep: eplDay
          ? { league: 39, season: eplSeason, fixturesWithOdds: eplDay.results, pages: eplDay.paging?.total ?? null, pageSize: eplDay.response?.length ?? 0 }
          : null,
        oddsHorizon: horizon,
      },
      null,
      2,
    ),
  );
}

main();
