export type CompetitionHubContent = {
  heading: string;
  intro: string;
  metadataTitle?: string;
  metadataDescription?: string;
};

const CONTENT: Record<number, CompetitionHubContent> = {
  39: {
    heading: "Premier League predictions",
    intro: "Current English Premier League picks alongside the table, upcoming fixtures, recent results and the settled record for predictions published in this competition.",
  },
  2: {
    heading: "Champions League predictions",
    intro: "UEFA Champions League predictions with the current competition fixtures, results, participating clubs and the public record of settled picks.",
    metadataTitle: "Champions League Predictions, Fixtures & Results",
    metadataDescription: "UEFA Champions League predictions with current fixtures, results, standings, clubs, top scorers and a public record of settled picks.",
  },
  3: {
    heading: "Europa League predictions",
    intro: "UEFA Europa League predictions with current fixtures, results, participating clubs and the public record of settled picks.",
    metadataTitle: "Europa League Predictions, Fixtures & Results",
    metadataDescription: "UEFA Europa League predictions with current fixtures, results, clubs, top scorers and a public record of settled picks.",
  },
  848: {
    heading: "Conference League predictions",
    intro: "UEFA Conference League predictions with current fixtures, results, participating clubs and the public record of settled picks.",
    metadataTitle: "Conference League Predictions & Results",
    metadataDescription: "UEFA Conference League predictions with current fixtures, results, clubs, top scorers and a public record of settled picks.",
  },
  399: {
    heading: "NPFL predictions",
    intro: "Current Nigeria Premier Football League picks with the NPFL table, upcoming fixtures, recent results and settled prediction evidence in one place.",
  },
  140: {
    heading: "La Liga predictions",
    intro: "Current Spanish La Liga picks alongside the standings, upcoming fixtures, recent results and the settled record for this competition.",
  },
  135: {
    heading: "Serie A predictions",
    intro: "Current Italian Serie A picks with the league table, fixtures ahead, recent results and settled prediction evidence for the competition.",
  },
  78: {
    heading: "Bundesliga predictions",
    intro: "Current German Bundesliga picks with the league table, upcoming fixtures, recent results and settled prediction evidence for the competition.",
  },
  61: {
    heading: "Ligue 1 predictions",
    intro: "Current French Ligue 1 picks with the league table, upcoming fixtures, recent results and settled prediction evidence for the competition.",
  },
  45: {
    heading: "FA Cup predictions",
    intro: "FA Cup predictions with current fixtures, results, participating clubs and the public record of settled picks.",
    metadataTitle: "FA Cup Predictions, Fixtures & Results",
    metadataDescription: "FA Cup predictions with current fixtures, results, participating clubs, top scorers and a public record of settled picks.",
  },
  48: {
    heading: "EFL Cup predictions",
    intro: "EFL Cup predictions with current fixtures, results, participating clubs and the public record of settled picks.",
    metadataTitle: "EFL Cup Predictions, Fixtures & Results",
    metadataDescription: "EFL Cup predictions with current fixtures, results, participating clubs, top scorers and a public record of settled picks.",
  },
  143: {
    heading: "Copa del Rey predictions",
    intro: "Copa del Rey predictions with current fixtures, results, participating clubs and the public record of settled picks.",
    metadataTitle: "Copa del Rey Predictions & Results",
    metadataDescription: "Copa del Rey predictions with current fixtures, results, participating clubs, top scorers and a public record of settled picks.",
  },
  137: {
    heading: "Coppa Italia predictions",
    intro: "Coppa Italia predictions with current fixtures, results, participating clubs and the public record of settled picks.",
    metadataTitle: "Coppa Italia Predictions & Results",
    metadataDescription: "Coppa Italia predictions with current fixtures, results, participating clubs, top scorers and a public record of settled picks.",
  },
  81: {
    heading: "DFB Pokal predictions",
    intro: "DFB Pokal predictions with current fixtures, results, participating clubs and the public record of settled picks.",
    metadataTitle: "DFB Pokal Predictions, Fixtures & Results",
    metadataDescription: "DFB Pokal predictions with current fixtures, results, participating clubs, top scorers and a public record of settled picks.",
  },
  66: {
    heading: "Coupe de France predictions",
    intro: "Coupe de France predictions with current fixtures, results, participating clubs and the public record of settled picks.",
    metadataTitle: "Coupe de France Predictions & Results",
    metadataDescription: "Coupe de France predictions with current fixtures, results, participating clubs, top scorers and a public record of settled picks.",
  },
};

export function competitionHubContent(leagueApiId: number | null | undefined): CompetitionHubContent | null {
  return leagueApiId == null ? null : CONTENT[leagueApiId] ?? null;
}
