export {};

type ApiEnvelope<T> = {
  errors: unknown;
  results: number;
  response: T;
};

const competitions = [
  { expected: "FA Cup", id: 45 },
  { expected: "Copa del Rey", id: 143 },
  { expected: "DFB Pokal", id: 81 },
  { expected: "Coppa Italia", id: 137 },
  { expected: "Coupe de France", id: 66 },
  { expected: "EFL Cup / Carabao Cup", id: 48 },
] as const;

const host = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
const key = process.env.API_FOOTBALL_KEY;
if (!key) throw new Error("API_FOOTBALL_KEY is not configured");

async function call<T>(path: string, params: Record<string, string | number>): Promise<ApiEnvelope<T>> {
  const url = new URL(`https://${host}${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const response = await fetch(url, { headers: { "x-apisports-key": key! } });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json() as Promise<ApiEnvelope<T>>;
}

function errorsOf(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 0) return null;
  if (value && typeof value === "object" && Object.keys(value).length === 0) return null;
  return value || null;
}

async function main() {
  const reports = [];
  const requestedId = process.argv[2] ? Number(process.argv[2]) : null;
  for (const competition of competitions.filter((item) => requestedId === null || item.id === requestedId)) {
    const meta = await call<any[]>("/leagues", { id: competition.id });
    const league = meta.response[0];
    const seasons = league?.seasons ?? [];
    const season = seasons.find((s: any) => s.year === 2025) ?? seasons.find((s: any) => s.current) ?? seasons.at(-1);
    if (!season) throw new Error(`No season metadata for ${competition.expected}`);

    const [fixtures, standings, scorers, teams] = await Promise.all([
      call<any[]>("/fixtures", { league: competition.id, season: season.year }),
      call<any[]>("/standings", { league: competition.id, season: season.year }),
      call<any[]>("/players/topscorers", { league: competition.id, season: season.year }),
      call<any[]>("/teams", { league: competition.id, season: season.year }),
    ]);
    const firstTeamId = teams.response[0]?.team?.id;
    const squad = firstTeamId
      ? await call<any[]>("/players/squads", { team: firstTeamId })
      : { errors: { local: "no team returned" }, results: 0, response: [] };

    const statusCounts: Record<string, number> = {};
    const specialFinishes: any[] = [];
    const fixtureTeams = new Map<number, string>();
    const roundBreakdown = new Map<string, { fixtures: number; teams: Map<number, string> }>();
    for (const fixture of fixtures.response) {
      const status = fixture.fixture?.status?.short ?? "UNKNOWN";
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      const round = fixture.league?.round ?? "UNKNOWN";
      const breakdown = roundBreakdown.get(round) ?? { fixtures: 0, teams: new Map<number, string>() };
      breakdown.fixtures += 1;
      for (const side of [fixture.teams?.home, fixture.teams?.away]) {
        if (!side?.id) continue;
        fixtureTeams.set(side.id, side.name);
        breakdown.teams.set(side.id, side.name);
      }
      roundBreakdown.set(round, breakdown);
      if (status === "AET" || status === "PEN") {
        specialFinishes.push({
          fixture: `${fixture.teams?.home?.name} vs ${fixture.teams?.away?.name}`,
          status,
          goals: fixture.goals,
          score: fixture.score,
        });
      }
    }

    reports.push({
      expected: competition.expected,
      apiIdentity: { id: league?.league?.id, name: league?.league?.name, type: league?.league?.type, country: league?.country?.name },
      season: season.year,
      advertisedCoverage: season.coverage,
      fixtures: {
        results: fixtures.results,
        errors: errorsOf(fixtures.errors),
        rounds: [...new Set(fixtures.response.map((f: any) => f.league?.round).filter(Boolean))],
        uniqueTeams: fixtureTeams.size,
        roundBreakdown: [...roundBreakdown.entries()].map(([round, value]) => ({
          round,
          fixtures: value.fixtures,
          uniqueTeams: value.teams.size,
          sampleTeams: [...value.teams.values()].slice(0, 12),
        })),
        statusCounts,
        specialFinishes: specialFinishes.slice(0, 3),
      },
      standings: {
        results: standings.results,
        errors: errorsOf(standings.errors),
        tableGroups: standings.response[0]?.league?.standings?.length ?? 0,
        rows: standings.response[0]?.league?.standings?.flat?.().length ?? 0,
      },
      topScorers: {
        results: scorers.results,
        errors: errorsOf(scorers.errors),
        populated: scorers.response.slice(0, 3).map((p: any) => ({ player: p.player?.name, appearances: p.statistics?.[0]?.games?.appearences, goals: p.statistics?.[0]?.goals?.total })),
      },
      teams: { results: teams.results, errors: errorsOf(teams.errors) },
      sampleSquad: {
        teamId: firstTeamId ?? null,
        results: squad.results,
        errors: errorsOf(squad.errors),
        playerCount: squad.response[0]?.players?.length ?? 0,
      },
    });
  }
  console.log(JSON.stringify(reports, null, 2));
}

main();
