import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { generatePredictionForFixture } from "@/lib/ai/analysis";
import { buildStoredContext } from "@/lib/ai/context";
import { isDigestEmpty } from "@/lib/ai/digest";
import { buildAnalysis } from "@/lib/predictionAnalysis";
import { searchTeam } from "@/lib/football/api-football";
import { buildGenerationDigest } from "@/lib/ai/generationContext";
import { setPredictionCategories } from "@/lib/predictions";
import { isValidSelection, deriveMarketAndPick, deriveOverUnderText, type MarketType, type Selection } from "@/lib/markets";
import { normalizeName } from "@/lib/slug";

export type GenerateFixtureInput = {
  fixtureId?: string;
  home: string;
  away: string;
  league: string;
  leagueApiId?: number;
  kickoff: string;
  categories: string[]; // at least one; categories[0] becomes the primary `category`
  authorId: string;
  /**
   * Pre-resolved api-football team ids, when the caller already has them.
   *
   * The scheduled worker and the bulk route both read fixtures straight from
   * /fixtures, whose rows already carry `teams.home.id` — passing them here
   * skips two searchTeam calls (plus their retry variants) per fixture that
   * were being spent re-deriving ids the caller was already holding. The manual
   * single-fixture form has only names, so it still falls back to searchTeam.
   */
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
};

/**
 * Resolves live context (form, injuries, standings, head-to-head) where possible,
 * asks the model for a prediction, and persists it as PENDING_REVIEW across all
 * requested categories. Shared by the single-fixture and bulk-generate routes.
 *
 * Which provider answered is recorded on the AIJob (`model`, e.g.
 * "gemini:gemini-2.5-flash" or "groq:openai/gpt-oss-120b") — see
 * src/lib/ai/analysis.ts for the fallback chain.
 */
export async function generateAndPersistPrediction(rawInput: GenerateFixtureInput) {
  // Trim/collapse whitespace up front so both the live-context lookups below
  // and the persisted row use the same team/league text (src/lib/slug.ts
  // computes read-time slugs from these fields — a stray double-space
  // shouldn't produce a second slug for what's really the same team/league).
  const input: GenerateFixtureInput = {
    ...rawInput,
    home: normalizeName(rawInput.home),
    away: normalizeName(rawInput.away),
    league: normalizeName(rawInput.league),
  };

  const kickoffDate = new Date(input.kickoff);

  // Ids first. A caller that already holds them (any fixture-list-driven path)
  // passes them straight through; only the manual form pays for a name lookup.
  let homeApiId = rawInput.homeTeamApiId ?? null;
  let awayApiId = rawInput.awayTeamApiId ?? null;
  let homeTeamName = input.home;
  let awayTeamName = input.away;

  if ((homeApiId == null || awayApiId == null) && input.leagueApiId) {
    const [homeMatch, awayMatch] = await Promise.all([
      homeApiId == null ? searchTeam(input.home) : Promise.resolve(null),
      awayApiId == null ? searchTeam(input.away) : Promise.resolve(null),
    ]);
    // One policy for one confidence signal: an unconfident match yields neither
    // an id nor a name. Writing the id anyway attaches another team's stats,
    // form, injuries and h2h to the prediction and seeds the enrichment cache
    // with them — a wrong-but-plausible id is strictly worse than a null one,
    // because nothing downstream can tell it was a bad guess.
    if (homeApiId == null && homeMatch?.confident) {
      homeApiId = homeMatch.id;
      // Prefer the API's own spelling, but only when the lookup was unambiguous.
      homeTeamName = homeMatch.name;
    }
    if (awayApiId == null && awayMatch?.confident) {
      awayApiId = awayMatch.id;
      awayTeamName = awayMatch.name;
    }
  }

  // Cache-first assembly. With warm enrichment this spends no api-football
  // quota at all; on a miss it refreshes through the cron's own writers so the
  // next reader is warm too. See src/lib/ai/generationContext.ts.
  const { digest, sources } = await buildGenerationDigest({
    home: homeTeamName,
    away: awayTeamName,
    league: input.league,
    kickoff: input.kickoff,
    homeApiId,
    awayApiId,
    leagueApiId: input.leagueApiId ?? null,
  });

  const startedAt = Date.now();
  const { output, usage, model } = await generatePredictionForFixture({ digest });
  const durationMs = Date.now() - startedAt;

  // A league was specified (live context was expected) but nothing resolved —
  // no stats, form, availability, h2h or standings for either side. Usually
  // means the football API failed silently (bad key, plan restriction, rate
  // limit) rather than the fixture genuinely having no data.
  const contextComplete = !input.leagueApiId ? true : !isDigestEmpty(digest);

  const job = await prisma.aIJob.create({
    data: {
      userId: input.authorId,
      prompt: JSON.stringify(input),
      model,
      rawOutput: JSON.stringify(output),
      status: "COMPLETED",
      contextComplete,
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
      durationMs,
      // Exactly what the model was shown, so a rewrite reproduces the same
      // evidence without re-hitting API-Football. Storing the digest rather
      // than the raw payloads means the replay is byte-identical to the
      // original prompt instead of merely equivalent.
      // Cast: MatchDigest is a plain JSON-serialisable object, but Prisma's
      // InputJsonValue won't accept a named interface without it.
      context: buildStoredContext(digest) as unknown as Prisma.InputJsonValue,
    },
  });

  const created = await Promise.all(
    output.predictions.map(async (p) => {
      // Defensive: even with a schema in the prompt, the model can still emit
      // a malformed marketType/selection. Fall back to OTHER (manual-only)
      // rather than persist a settlement field that doesn't match its shape.
      const validStructured = isValidSelection(p.marketType, p.selection);
      const marketType: MarketType = validStructured ? p.marketType : "OTHER";
      const selection: Selection = validStructured ? p.selection : null;
      // Fallback only matters if Gemini emits something malformed despite the
      // schema — there's no usable free-text market/pick to recover in that
      // case, so this becomes a clearly-incomplete row for the admin to fix.
      const { market, pick } = deriveMarketAndPick(marketType, selection, homeTeamName, awayTeamName, {
        market: "Other",
        pick: "",
      });

      const validOU = typeof p.overUnderLine === "number" && (p.overUnderDirection === "OVER" || p.overUnderDirection === "UNDER");
      const ouLine = validOU ? p.overUnderLine : null;
      const ouDirection = validOU ? p.overUnderDirection : null;

      const pred = await prisma.prediction.create({
        data: {
          fixtureId: input.fixtureId,
          category: input.categories[0],
          leagueApiId: input.leagueApiId,
          leagueName: input.league,
          homeTeam: homeTeamName,
          awayTeam: awayTeamName,
          homeTeamApiId: homeApiId,
          awayTeamApiId: awayApiId,
          kickoff: isNaN(kickoffDate.getTime()) ? undefined : kickoffDate,
          status: "PENDING_REVIEW",
          marketType,
          selection: selection ?? undefined,
          manualSettlementOnly: marketType === "OTHER",
          market,
          pick,
          ouLine,
          ouDirection,
          overUnder: deriveOverUnderText(ouLine, ouDirection),
          odds: output.suggestedOdds,
          confidence: Math.min(90, Math.max(0, Math.round(p.confidence))),
          reasoning: p.reasoning,
          matchPreview: output.matchPreview,
          // keyFactors has been generated since the beginning and dropped here.
          // Shared across this job's rows exactly as matchPreview is — one
          // analysis, several market rows.
          analysisJson: buildAnalysis(output) as unknown as Prisma.InputJsonValue,
          contextComplete,
          authorId: input.authorId,
          aiJobId: job.id,
        },
      });
      await setPredictionCategories(pred.id, input.categories);
      return pred;
    }),
  );

  return { job, preview: output.matchPreview, predictions: created, sources, durationMs };
}
