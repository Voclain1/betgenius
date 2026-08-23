export {};

const key = process.env.API_FOOTBALL_KEY;
const host = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
if (!key) throw new Error("API_FOOTBALL_KEY is not configured");

const competitions = [
  { id: 48, name: "EFL Cup", included: null },
  { id: 143, name: "Copa del Rey", included: ["Round of 128", "Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"] },
  { id: 137, name: "Coppa Italia", included: null },
  { id: 66, name: "Coupe de France", included: ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"] },
] as const;

async function fixtures(league: number) {
  const url = new URL(`https://${host}/fixtures`);
  url.searchParams.set("league", String(league));
  url.searchParams.set("season", process.argv[2] ?? "2025");
  const response = await fetch(url, { headers: { "x-apisports-key": key! } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as any;
  if (body.errors && Object.keys(body.errors).length) throw new Error(JSON.stringify(body.errors));
  return body.response as any[];
}

async function main() {
  for (const competition of competitions) {
    const all = await fixtures(competition.id);
    const scoped = competition.included
      ? all.filter((fixture) => (competition.included as readonly string[]).includes(fixture.league.round))
      : all;
    const teams = new Set<number>();
    for (const fixture of scoped) {
      teams.add(fixture.teams.home.id);
      teams.add(fixture.teams.away.id);
    }
    console.log(JSON.stringify({
      id: competition.id,
      name: competition.name,
      totalFixtures: all.length,
      proposedFixtures: scoped.length,
      proposedTeams: teams.size,
      excludedRounds: [...new Set(all.filter((fixture) => !scoped.includes(fixture)).map((fixture) => fixture.league.round))],
      allRounds: [...new Set(all.map((fixture) => fixture.league.round))],
    }));
  }
}

main();
