import { cache } from "react";
import { getFixturesByLeague, resolveSeason, type FixtureRow } from "@/lib/football/api-football";
import type { LeaguePlayerStat, LeagueStandingRow } from "@/lib/enrichment";
import { getPublishedTeamIndex, publishedTeamHref, type LeagueClub } from "@/lib/predictionScope";
import { cupBySlug, fixtureIsInCupScope, type CupConfig } from "@/lib/cupConfig";
import { prisma } from "@/lib/prisma";
export { cupBySlug } from "@/lib/cupConfig";

export type CupPageData = {
  cup: CupConfig;
  season: number;
  fixtures: FixtureRow[];
  rounds: string[];
  clubs: LeagueClub[];
  scorers: LeaguePlayerStat[];
  standings: LeagueStandingRow[];
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

  // Provider round labels change between seasons. Configured aliases establish
  // editorial order; newly observed labels are retained rather than silently
  // dropping a round from a full-scope cup page.
  const observedRounds = [...new Set(fixtures.map((fixture) => fixture.league.round).filter((round): round is string => !!round))];
  const unknownRounds = observedRounds
    .filter((round) => !cup.rounds.includes(round))
    .sort((a, b) => {
      const first = (round: string) => Math.min(...fixtures.filter((fixture) => fixture.league.round === round).map((fixture) => new Date(fixture.fixture.date).getTime()));
      return first(a) - first(b);
    });
  const roundOrder = [...cup.rounds, ...unknownRounds];
  fixtures.sort((a, b) =>
    roundOrder.indexOf(a.league.round ?? "") - roundOrder.indexOf(b.league.round ?? "")
    || new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime(),
  );
  const rounds = roundOrder.filter((round) => observedRounds.includes(round));

  // Same rule as the league grid: every participating club is listed, but only
  // the ones with a published prediction carry a link — the rest have no team
  // page worth sending a reader or a crawler to.
  const publishedTeams = await getPublishedTeamIndex();
  const clubMap = new Map<number, LeagueClub>();
  for (const fixture of fixtures) {
    for (const team of [fixture.teams.home, fixture.teams.away]) {
      clubMap.set(team.id, {
        teamId: team.id,
        teamName: team.name,
        crest: team.logo ?? null,
        slug: publishedTeamHref(publishedTeams, team.id, team.name),
      });
    }
  }
  const clubs = [...clubMap.values()].sort((a, b) => a.teamName.localeCompare(b.teamName));
  const leagueCache = cup.capabilities.playerStats || cup.capabilities.standings
    ? await prisma.leagueEnrichmentCache.findUnique({ where: { leagueApiId: cup.id }, select: { topScorersJson: true, standingsJson: true } })
    : null;
  const scorers = (leagueCache?.topScorersJson as unknown as LeaguePlayerStat[] | null) ?? [];
  const standings = (leagueCache?.standingsJson as unknown as LeagueStandingRow[] | null) ?? [];

  return { cup, season, fixtures, rounds, clubs, scorers, standings };
});
