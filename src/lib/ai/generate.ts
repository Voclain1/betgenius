import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { generatePredictionForFixture } from "@/lib/ai/analysis";
import { buildStoredContext } from "@/lib/ai/context";
import { isDigestEmpty } from "@/lib/ai/digest";
import { buildAnalysis } from "@/lib/predictionAnalysis";
import { searchTeam } from "@/lib/football/api-football";
import { buildGenerationDigest } from "@/lib/ai/generationContext";
import { setPredictionCategories } from "@/lib/predictions";
import { isValidSelection, deriveMarketAndPick, deriveOverUnderText, type MarketType, type Selection, isGeneratableTeamTotal } from "@/lib/markets";
import { normalizeName } from "@/lib/slug";
import { resolveGenerationRisk } from "@/lib/ai/generationRisk";
import { marketBreadthForCategories, REGULAR_COMBO_INTENT, SAME_GAME_DOUBLE } from "@/lib/doublesTargeting";
import { assembleGeneratedSameGameDouble } from "@/lib/sameGameDoubleAssembly";
import { scanDraftForCertainty, type CertaintyViolation } from "@/lib/certaintyLanguage";
import { scanDraftForInternalTerminology, type InternalTerminologyViolation } from "@/lib/houseVoice";
import { normalizeLeagueName } from "@/lib/leagues";

/**
 * Thrown when a draft asserts certainty. Carries the violations so the failure
 * is actionable — which phrase, in which field — rather than a bare rejection.
 */
/**
 * Thrown when a draft narrates our own machinery at the reader — a tier name,
 * a calibration, a guideline. Same reject-don't-edit stance as the certainty
 * scan: the sentence was built around the house concept, so removing the words
 * leaves prose arguing from a rule the reader still cannot see.
 */
export class HouseVoiceError extends Error {
  readonly violations: InternalTerminologyViolation[];
  constructor(violations: InternalTerminologyViolation[]) {
    super(`Draft rejected — internal terminology leaked to the reader: ${violations.map((v) => `${v.field}:"${v.match}"`).join(", ")}`);
    this.name = "HouseVoiceError";
    this.violations = violations;
  }
}

export class CertaintyLanguageError extends Error {
  readonly violations: CertaintyViolation[];
  constructor(violations: CertaintyViolation[]) {
    super(`Draft rejected — prohibited certainty language: ${violations.map((v) => `${v.field}:"${v.match}"`).join(", ")}`);
    this.name = "CertaintyLanguageError";
    this.violations = violations;
  }
}

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
  /** API-Football knockout round, supplied by fixture-list generation paths. */
  round?: string | null;
  /**
   * What this job is FOR, when that is not simply its categories.
   *
   * Recorded because the whole input object is persisted as AIJob.prompt, which
   * is how daily quotas are counted. Market-Confirmed generation cannot be
   * identified by categories the way doubles can — its rows are tagged
   * VIP/PREMIUM only AFTER they pass the odds gate, and a job that generated a
   * pick which then failed the gate still spent its slot and its money. The
   * quota has to count attempts, so the attempt has to be labelled.
   */
  intent?: string;
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
  const leagueName = normalizeLeagueName(rawInput.league);
  if (!leagueName) {
    throw new Error("Prediction generation requires a real league name; placeholders cannot be persisted");
  }
  // Trim/collapse whitespace up front so both the live-context lookups below
  // and the persisted row use the same team/league text (src/lib/slug.ts
  // computes read-time slugs from these fields — a stray double-space
  // shouldn't produce a second slug for what's really the same team/league).
  const input: GenerateFixtureInput = {
    ...rawInput,
    home: normalizeName(rawInput.home),
    away: normalizeName(rawInput.away),
    league: normalizeName(leagueName),
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
    round: input.round ?? null,
  });

  const startedAt = Date.now();
  const riskRoute = resolveGenerationRisk(input.categories, input.leagueApiId);
  // A regular-combo or legacy doubles job asks for several markets so a
  // same-game double can be assembled from independently-reasoned rows.
  // Market-Confirmed also uses multi breadth for its separate odds gate.
  const marketBreadth = marketBreadthForCategories(input.categories, input.intent);
  const { output, usage, model } = await generatePredictionForFixture({
    digest,
    tiers: riskRoute.promptTiers,
    riskCalibration: riskRoute.calibration !== "legacy",
    marketBreadth,
  });
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

  // Deterministic certainty scan, BEFORE anything is persisted.
  //
  // The prompt has forbidden certainty language since the beginning, with
  // nothing behind it but the model's compliance. This rejects rather than
  // edits: stripping the offending word would leave prose written to argue
  // inevitability, minus the one token that made the claim reviewable.
  const certaintyViolations = scanDraftForCertainty({
    matchPreview: output.matchPreview,
    keyFactors: output.keyFactors,
    reasoning: output.predictions.map((p) => p.reasoning).join("\n\n"),
  });
  if (certaintyViolations.length > 0) {
    throw new CertaintyLanguageError(certaintyViolations);
  }

  // Same gate, different failure: reasoning that explains our pipeline instead
  // of the football. Real published output said "In line with the Genius tier
  // risk calibration..." — a sentence about us, printed where the analysis
  // should be.
  const voiceViolations = scanDraftForInternalTerminology({
    matchPreview: output.matchPreview,
    keyFactors: output.keyFactors,
    reasoning: output.predictions.map((p) => p.reasoning).join("\n\n"),
  });
  if (voiceViolations.length > 0) {
    throw new HouseVoiceError(voiceViolations);
  }

  const created = await Promise.all(
    output.predictions.map(async (p) => {
      // Defensive: even with a schema in the prompt, the model can still emit
      // a malformed marketType/selection. Fall back to OTHER (manual-only)
      // rather than persist a settlement field that doesn't match its shape.
      // A TEAM_TOTAL on a line generation may not use is treated as malformed,
      // not silently accepted. The prompt states the rule; this is what makes
      // it true. Same reasoning as the certainty scan above — a prompt alone
      // has already proven insufficient once.
      const generatableLine = p.marketType !== "TEAM_TOTAL" || isGeneratableTeamTotal(p.selection);
      const validStructured = isValidSelection(p.marketType, p.selection) && generatableLine;
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

      const isolatesComboLegs = input.intent === REGULAR_COMBO_INTENT || input.categories.includes(SAME_GAME_DOUBLE);
      const persistedCategories = isolatesComboLegs ? [SAME_GAME_DOUBLE] : input.categories;
      const pred = await prisma.prediction.create({
        data: {
          fixtureId: input.fixtureId,
          category: persistedCategories[0],
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
          odds: null,
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
      await setPredictionCategories(pred.id, persistedCategories);
      return pred;
    }),
  );

  const combo = marketBreadth === "multi" && input.intent !== "MARKET_CONFIRMED"
    ? await assembleGeneratedSameGameDouble(created.map((prediction) => prediction.id), input.categories)
    : null;

  return { job, preview: output.matchPreview, predictions: created, combo, sources, durationMs };
}
