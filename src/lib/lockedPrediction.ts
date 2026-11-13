/**
 * What a reader who cannot view a prediction's category may receive about it:
 * the fixture, never the pick.
 *
 * An ALLOWLIST, not a blocklist. /api/predictions used to spread the whole row
 * and blank four fields (pick, reasoning, confidence, odds), so a locked VIP or
 * Premium row still carried its `selection`, `market`, `marketType`, goal line,
 * `analysisJson`, `marketConfirmation` and earlier drafts — the pick, in all
 * but name, to anyone calling the endpoint. Any column added later is withheld
 * by default.
 */
const FIXTURE_FIELDS = [
  "id", "category", "categories", "leagueApiId", "leagueName", "homeTeam", "awayTeam", "homeTeamApiId", "awayTeamApiId",
  "kickoff", "status", "outcome", "finalHomeScore", "finalAwayScore", "fixture", "fixtureId", "fixtureApiId", "publishedAt",
  "leagueSlugKey", "homeSlugKey", "awaySlugKey", "matchSlugKey", "h2hSlugKey",
] as const;

export function lockedPredictionView<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of FIXTURE_FIELDS) if (k in row) out[k] = row[k];
  return { ...out, pick: "LOCKED", reasoning: "Subscribe to unlock this prediction.", matchPreview: null, confidence: null, odds: null, locked: true };
}
