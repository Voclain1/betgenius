export type CupCapabilities = {
  standings: boolean;
  playerStats: boolean;
  odds: boolean;
  events: boolean;
  lineups: boolean;
  fixtureStats: boolean;
};

export type CupConfig = {
  id: number;
  slug: string;
  name: string;
  country: string;
  format: "knockout" | "hybrid";
  rounds: readonly string[];
  includeAllRounds: boolean;
  scopeNote: string;
  capabilities: CupCapabilities;
};

const KNOCKOUT_ROUNDS = [
  "Preliminary Round", "1st Preliminary Round", "2nd Preliminary Round",
  "Qualifying Round", "1st Round", "Round 1", "Round of 128", "1/128-finals",
  "2nd Round", "Round of 64", "3rd Round", "Round of 32", "4th Round",
  "Round of 16", "Quarter-finals", "Semi-finals", "Final",
] as const;

const UEFA_ROUNDS = [
  "Preliminary Round", "1st Qualifying Round", "2nd Qualifying Round",
  "3rd Qualifying Round", "Play-offs", "League Stage - 1", "League Stage - 2",
  "League Stage - 3", "League Stage - 4", "League Stage - 5", "League Stage - 6",
  "League Stage - 7", "League Stage - 8", "Knockout Round Play-offs",
  "Round of 16", "Quarter-finals", "Semi-finals", "Final",
] as const;

const GROUP_CUP_ROUNDS = [
  "1st Round", "2nd Round", "3rd Round", "Group Stage - 1", "Group Stage - 2",
  "Group Stage - 3", "Group Stage - 4", "Round of 16", "Quarter-finals",
  "Semi-finals", "Final",
] as const;

const sparse = (overrides: Partial<CupCapabilities> = {}): CupCapabilities => ({
  standings: false, playerStats: false, odds: false, events: false,
  lineups: false, fixtureStats: false, ...overrides,
});

export const CUP_CONFIGS: readonly CupConfig[] = [
  { id: 2, slug: "uefa-champions-league", name: "UEFA Champions League", country: "Europe", format: "hybrid", rounds: UEFA_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ standings: true, playerStats: true, odds: true, events: true, lineups: true, fixtureStats: true }) },
  { id: 3, slug: "uefa-europa-league", name: "UEFA Europa League", country: "Europe", format: "hybrid", rounds: UEFA_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ standings: true, playerStats: true, odds: true, events: true, lineups: true, fixtureStats: true }) },
  { id: 848, slug: "uefa-conference-league", name: "UEFA Conference League", country: "Europe", format: "hybrid", rounds: UEFA_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ standings: true, playerStats: true, odds: true, events: true, lineups: true, fixtureStats: true }) },

  { id: 45, slug: "fa-cup", name: "FA Cup", country: "England", format: "knockout", rounds: ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"], includeAllRounds: false, scopeNote: "Third Round Proper onward", capabilities: sparse({ playerStats: true, odds: true, events: true, lineups: true, fixtureStats: true }) },
  { id: 48, slug: "efl-cup", name: "EFL Cup", country: "England", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ playerStats: true, odds: true, events: true, lineups: true, fixtureStats: true }) },
  { id: 143, slug: "copa-del-rey", name: "Copa del Rey", country: "Spain", format: "knockout", rounds: ["Round of 128", "Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"], includeAllRounds: false, scopeNote: "Round of 128 onward", capabilities: sparse({ playerStats: true, odds: true, events: true, lineups: true, fixtureStats: true }) },
  { id: 137, slug: "coppa-italia", name: "Coppa Italia", country: "Italy", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ playerStats: true, odds: true, events: true, lineups: true, fixtureStats: true }) },
  { id: 81, slug: "dfb-pokal", name: "DFB Pokal", country: "Germany", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ playerStats: true, odds: true, events: true, lineups: true, fixtureStats: true }) },
  { id: 66, slug: "coupe-de-france", name: "Coupe de France", country: "France", format: "knockout", rounds: ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"], includeAllRounds: false, scopeNote: "Round of 64 onward", capabilities: sparse({ playerStats: true, odds: true, events: true, lineups: true, fixtureStats: true }) },

  { id: 96, slug: "taca-de-portugal", name: "Taça de Portugal", country: "Portugal", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse() },
  { id: 90, slug: "knvb-beker", name: "KNVB Beker", country: "Netherlands", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse() },
  { id: 147, slug: "belgian-cup", name: "Belgian Cup", country: "Belgium", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ playerStats: true, events: true, lineups: true }) },
  { id: 181, slug: "scottish-cup", name: "Scottish Cup", country: "Scotland", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ playerStats: true, events: true, lineups: true, fixtureStats: true }) },
  { id: 206, slug: "turkish-cup", name: "Turkish Cup", country: "Turkey", format: "hybrid", rounds: GROUP_CUP_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ standings: true, playerStats: true, events: true, lineups: true, fixtureStats: true }) },
  { id: 199, slug: "greek-cup", name: "Greek Cup", country: "Greece", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ odds: true, events: true }) },
  { id: 220, slug: "austrian-cup", name: "Austrian Cup", country: "Austria", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ events: true }) },
  { id: 209, slug: "swiss-cup", name: "Swiss Cup", country: "Switzerland", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ events: true }) },
  { id: 121, slug: "danish-cup", name: "Danish Cup", country: "Denmark", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ odds: true, events: true, lineups: true }) },
  { id: 105, slug: "norwegian-cup", name: "Norwegian Cup", country: "Norway", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ odds: true, events: true }) },
  { id: 115, slug: "svenska-cupen", name: "Svenska Cupen", country: "Sweden", format: "hybrid", rounds: GROUP_CUP_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ odds: true, events: true }) },
  { id: 108, slug: "polish-cup", name: "Polish Cup", country: "Poland", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ events: true }) },
  { id: 212, slug: "croatian-cup", name: "Croatian Cup", country: "Croatia", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse() },
  { id: 732, slug: "serbian-cup", name: "Serbian Cup", country: "Serbia", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse() },
  { id: 285, slug: "romanian-cup", name: "Romanian Cup", country: "Romania", format: "hybrid", rounds: GROUP_CUP_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ odds: true, events: true }) },
  { id: 347, slug: "czech-cup", name: "Czech Cup", country: "Czech Republic", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ odds: true, events: true, lineups: true }) },
  { id: 335, slug: "ukrainian-cup", name: "Ukrainian Cup", country: "Ukraine", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ odds: true, events: true }) },
  { id: 359, slug: "fai-cup", name: "FAI Cup", country: "Ireland", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ events: true, lineups: true }) },
  { id: 112, slug: "welsh-cup", name: "Welsh Cup", country: "Wales", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ playerStats: true, events: true, lineups: true }) },
  { id: 167, slug: "icelandic-cup", name: "Icelandic Cup", country: "Iceland", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ playerStats: true, events: true, lineups: true }) },
  { id: 321, slug: "cyprus-cup", name: "Cyprus Cup", country: "Cyprus", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ playerStats: true, events: true, lineups: true }) },
  { id: 384, slug: "israeli-state-cup", name: "Israeli State Cup", country: "Israel", format: "knockout", rounds: KNOCKOUT_ROUNDS, includeAllRounds: true, scopeNote: "Full competition", capabilities: sparse({ playerStats: true, events: true, lineups: true }) },
];

export function cupById(id?: number | null): CupConfig | null {
  return CUP_CONFIGS.find((cup) => cup.id === id) ?? null;
}

export function cupBySlug(slug: string): CupConfig | null {
  return CUP_CONFIGS.find((cup) => cup.slug === slug) ?? null;
}

export function isCupCompetition(id?: number | null): boolean {
  return cupById(id) !== null;
}

export function cupSupports(id: number | null | undefined, capability: keyof CupCapabilities): boolean {
  return cupById(id)?.capabilities[capability] ?? true;
}

export function fixtureIsInCupScope(leagueApiId: number, round?: string | null): boolean {
  const cup = cupById(leagueApiId);
  if (!cup || cup.includeAllRounds) return true;
  return !!round && cup.rounds.includes(round);
}

export function competitionPredictionsHref(leagueApiId: number | null | undefined, leagueSlug: string): string {
  const cup = cupById(leagueApiId);
  return cup ? `/predictions/cup/${cup.slug}` : `/predictions/league/${leagueSlug}`;
}
