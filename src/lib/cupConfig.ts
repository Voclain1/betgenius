export const CUP_CONFIGS = [
  {
    id: 45,
    slug: "fa-cup",
    name: "FA Cup",
    country: "England",
    rounds: ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
    scopeNote: "Third Round Proper onward",
  },
  {
    id: 81,
    slug: "dfb-pokal",
    name: "DFB Pokal",
    country: "Germany",
    // API-Football has used both naming schemes across seasons. Unmatched
    // aliases are omitted by the page, so each season still shows one round.
    rounds: ["1st Round", "Round of 64", "2nd Round", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
    scopeNote: "Full competition",
  },
] as const;

export type CupConfig = (typeof CUP_CONFIGS)[number];

export function cupById(id?: number | null): CupConfig | null {
  return CUP_CONFIGS.find((cup) => cup.id === id) ?? null;
}

export function cupBySlug(slug: string): CupConfig | null {
  return CUP_CONFIGS.find((cup) => cup.slug === slug) ?? null;
}

export function isCupCompetition(id?: number | null): boolean {
  return cupById(id) !== null;
}

export function fixtureIsInCupScope(leagueApiId: number, round?: string | null): boolean {
  const cup = cupById(leagueApiId);
  if (!cup) return true;
  // Only the FA Cup needs a scope cutoff. DFB Pokal intentionally includes
  // the entire competition, including future API round-name variants.
  if (leagueApiId === 81) return true;
  return !!round && (cup.rounds as readonly string[]).includes(round);
}

export function competitionPredictionsHref(leagueApiId: number | null | undefined, leagueSlug: string): string {
  const cup = cupById(leagueApiId);
  return cup ? `/predictions/cup/${cup.slug}` : `/predictions/league/${leagueSlug}`;
}
