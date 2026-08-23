export {};

const key = process.env.API_FOOTBALL_KEY;
const host = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
if (!key) throw new Error("API_FOOTBALL_KEY is not configured");

async function call(path: string, params: Record<string, string | number>) {
  const url = new URL(`https://${host}${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const response = await fetch(url, { headers: { "x-apisports-key": key! } });
  return response.json() as Promise<any>;
}

async function main() {
const fixtures = await call("/fixtures", { league: 45, season: 2025 });
const all = fixtures.response ?? [];
const counts = Object.entries(
  all.reduce((map: Record<string, number>, fixture: any) => {
    const round = fixture.league.round;
    map[round] = (map[round] ?? 0) + 1;
    return map;
  }, {}),
);
const firstProperRound = "Round of 64";
const includedRounds = ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"];
const filtered = all.filter((fixture: any) => includedRounds.includes(fixture.league.round));
const teams = new Map<number, string>();
for (const fixture of filtered) {
  teams.set(fixture.teams.home.id, fixture.teams.home.name);
  teams.set(fixture.teams.away.id, fixture.teams.away.name);
}

console.log(JSON.stringify({
  apiResults: all.length,
  exactRoundCounts: counts,
  firstProperRound,
  includedRounds,
  filteredFixtures: filtered.length,
  filteredTeams: teams.size,
  sampleTeams: [...teams.values()].slice(0, 12),
}, null, 2));
}

main();
