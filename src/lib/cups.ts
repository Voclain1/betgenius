import { cache } from "react";
import { getFixturesByLeague, getTopScorers, resolveSeason, type FixtureRow } from "@/lib/football/api-football";
import { trimPlayerStats, type LeaguePlayerStat } from "@/lib/enrichment";
import type { LeagueClub } from "@/lib/predictionScope";
import { cupBySlug, fixtureIsInCupScope, type CupConfig } from "@/lib/cupConfig";
export { cupBySlug } from "@/lib/cupConfig";

export type CupPageData = {
  cup: CupConfig;
  season: number;
  fixtures: FixtureRow[];
  rounds: string[];
  clubs: LeagueClub[];
  scorers: LeaguePlayerStat[];
};

async function loadSeason(cup: CupConfig, season: number): Promise<FixtureRow[]> {
  const rows = (await getFixturesByLeague(cup.id, season)) ?? [];
  return rows.filter((fixture) => fixtureIsInCupScope(cup.id, fixture.league.round));
}

export const getCupPageData = cache(async (slug: string, requestedSeason?: number): Promise<CupPageData | null> => {
  const cup = cupBySlug(slug);
  if (!cup) return null;

  const currentSeason = await resolveSeason(cup.id, new Date());
  let season = requestedSeason ?? currentSeason;
  let fixtures = await loadSeason(cup, season);
  // FA Cup proper is populated progressively. Before the January Third Round
  // draw, show the latest complete proper-round history instead of 700+
  // qualifying fixtures or an empty page.
  if (fixtures.length === 0 && requestedSeason == null) {
    season = currentSeason - 1;
    fixtures = await loadSeason(cup, season);
  }

  const roundOrder = cup.rounds as readonly string[];
  fixtures.sort((a, b) =>
    roundOrder.indexOf(a.league.round ?? "") - roundOrder.indexOf(b.league.round ?? "")
    || new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime(),
  );
  const rounds = roundOrder.filter((round) => fixtures.some((fixture) => fixture.league.round === round));

  const clubMap = new Map<number, LeagueClub>();
  for (const fixture of fixtures) {
    for (const team of [fixture.teams.home, fixture.teams.away]) {
      clubMap.set(team.id, { teamId: team.id, teamName: team.name, crest: team.logo ?? null });
    }
  }
  const clubs = [...clubMap.values()].sort((a, b) => a.teamName.localeCompare(b.teamName));
  const scorers = trimPlayerStats(await getTopScorers(cup.id, season), "goals");

  return { cup, season, fixtures, rounds, clubs, scorers };
});
