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
    id: 48,
    slug: "efl-cup",
    name: "EFL Cup",
    country: "England",
    // Both naming schemes are live across adjacent API seasons.
    rounds: ["Preliminary Round", "1st Round", "Round of 128", "2nd Round", "Round of 64", "3rd Round", "Round of 32", "4th Round", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
    scopeNote: "Full competition",
  },
  {
    id: 143,
    slug: "copa-del-rey",
    name: "Copa del Rey",
    country: "Spain",
    rounds: ["Round of 128", "Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
    scopeNote: "Round of 128 onward",
  },
  {
    id: 137,
    slug: "coppa-italia",
    name: "Coppa Italia",
    country: "Italy",
    // 2025 used numbered rounds; 2026 switched to bracket-size names.
    rounds: ["Preliminary Round", "Round of 128", "1st Round", "Round of 64", "2nd Round", "Round of 32", "3rd Round", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
    scopeNote: "Full competition",
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
  {
    id: 66,
    slug: "coupe-de-france",
    name: "Coupe de France",
    country: "France",
    rounds: ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
    scopeNote: "Round of 64 onward",
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
  // Full-scope cups accept future API round-name variants. Scoped cups use
  // their explicit allow-list so qualifying fixtures never leak into pages or
  // scheduled generation.
  if (cup.scopeNote === "Full competition") return true;
  return !!round && (cup.rounds as readonly string[]).includes(round);
}

export function competitionPredictionsHref(leagueApiId: number | null | undefined, leagueSlug: string): string {
  const cup = cupById(leagueApiId);
  return cup ? `/predictions/cup/${cup.slug}` : `/predictions/league/${leagueSlug}`;
}
