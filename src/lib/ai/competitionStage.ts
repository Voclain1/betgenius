/** Competition type is not the fixture stage: UEFA cups include league phases. */
export function competitionStage(fixture: { competitionType?: string; round?: string | null }): "league" | "knockout" | "unknown" {
  const round = fixture.round?.trim() ?? "";
  if (/\b(?:league\s+(?:stage|phase)|group\s+(?:stage|phase|[a-z]|\d+)|regular\s+season)\b/i.test(round)) return "league";
  if (/\b(?:round\s+of\s+\d+|quarter[ -]?finals?|semi[ -]?finals?|final|knockout)\b/i.test(round)) return "knockout";
  return fixture.competitionType === "LEAGUE" && !round ? "league" : "unknown";
}

export class CompetitionStageError extends Error {
  constructor() {
    super("Generated knockout-tie wording is unsupported by the supplied fixture stage; rejected before persistence.");
    this.name = "CompetitionStageError";
  }
}

/** Conservative known contradiction, not a claim to validate every football fact. */
export function assertCompetitionStage(
  fixture: { competitionType?: string; round?: string | null },
  output: { matchPreview?: string; keyFactors?: string[]; predictions?: Array<{ reasoning?: string }> },
): void {
  if (competitionStage(fixture) === "knockout") return;
  const texts = [output.matchPreview, ...(output.keyFactors ?? []), ...(output.predictions ?? []).map((p) => p.reasoning)];
  if (texts.some((text) => typeof text === "string" && /\bknock[ -]?out\s+(?:cup\s+)?(?:tie|clash|encounter|match|game)\b/i.test(text))) {
    throw new CompetitionStageError();
  }
}
