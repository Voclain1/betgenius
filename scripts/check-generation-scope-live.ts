import { prisma } from "../src/lib/prisma";
import { LEAGUE_CATALOGUE, LEAGUE_PRIORITY_ORDER } from "../src/lib/leagues";

const key = process.env.API_FOOTBALL_KEY;
const host = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
if (!key) throw new Error("API_FOOTBALL_KEY is not configured");

async function api(path: string, params: Record<string, string | number>) {
  const url = new URL(`https://${host}${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const response = await fetch(url, { headers: { "x-apisports-key": key! } });
  return response.json() as Promise<any>;
}

async function main() {
  const catalogueIds = new Set(LEAGUE_CATALOGUE.map((league) => league.id));
  const priorityMissingFromScheduledDefault = LEAGUE_PRIORITY_ORDER.filter((id) => !catalogueIds.has(id));
  const bundesliga = LEAGUE_CATALOGUE.find((league) => league.id === 78);

  const meta = await api("/leagues", { id: 78 });
  const seasons = meta.response?.[0]?.seasons ?? [];
  const season = seasons.find((value: any) => value.current) ?? seasons.at(-1);
  const from = "2026-08-23";
  const to = "2026-08-30";
  const fixtures = season ? await api("/fixtures", { league: 78, season: season.year, from, to }) : null;

  const ledger = await prisma.generationAttempt.groupBy({
    by: ["leagueApiId"],
    _count: { _all: true },
    orderBy: { _count: { leagueApiId: "desc" } },
  });
  const bundesligaLedger = ledger.find((row) => row.leagueApiId === 78)?._count._all ?? 0;

  console.log(JSON.stringify({
    scheduledDefaultCount: LEAGUE_CATALOGUE.length,
    bundesligaInScheduledDefault: !!bundesliga,
    bundesligaCatalogueEntry: bundesliga,
    priorityMissingFromScheduledDefault,
    currentSeason: season ? { year: season.year, start: season.start, end: season.end, current: season.current } : null,
    fixturesAug23To30: {
      errors: fixtures?.errors ?? null,
      results: fixtures?.results ?? null,
      games: fixtures?.response?.map((row: any) => ({ date: row.fixture.date, status: row.fixture.status.short, home: row.teams.home.name, away: row.teams.away.name })) ?? [],
    },
    bundesligaGenerationLedgerRows: bundesligaLedger,
    ledgerLeagueIds: ledger.map((row) => row.leagueApiId),
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
