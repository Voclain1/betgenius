import { prisma } from "@/lib/prisma";
import { generatePredictionForFixture } from "@/lib/ai/gemini";
import { getTeamContext, getStandings, getHeadToHead, searchTeam, resolveSeason } from "@/lib/football/api-football";
import { setPredictionCategories } from "@/lib/predictions";
import { isValidSelection, deriveMarketAndPick, deriveOverUnderText, type MarketType, type Selection } from "@/lib/markets";
import { normalizeName } from "@/lib/slug";

// getTeamContext still returns a (truthy) object even when every field inside
// it failed/came back empty, so a plain null-check on the object isn't enough.
function isTeamContextEmpty(ctx: Awaited<ReturnType<typeof getTeamContext>> | null): boolean {
  if (!ctx) return true;
  const noStats = !ctx.statistics;
  const noInjuries = !ctx.injuries || (Array.isArray(ctx.injuries) && ctx.injuries.length === 0);
  const noFixtures = !ctx.lastFixtures || ctx.lastFixtures.length === 0;
  return noStats && noInjuries && noFixtures;
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
};

/**
 * Resolves live context (form, injuries, standings, head-to-head) where possible,
 * asks Gemini for a prediction, and persists it as PENDING_REVIEW across all
 * requested categories. Shared by the single-fixture and bulk-generate routes.
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

  // Resolve from the fixture's own kickoff date/league, not "today" — a
  // February fixture belongs to the season that started the previous August.
  const kickoffDate = new Date(input.kickoff);
  const season = input.leagueApiId
    ? await resolveSeason(input.leagueApiId, isNaN(kickoffDate.getTime()) ? new Date() : kickoffDate)
    : new Date().getFullYear();

  // Best-effort: resolve team ids from names so we can pull live context.
  // Falls back to null context (model reasons from names alone) if lookup fails.
  const [homeMatch, awayMatch] = input.leagueApiId
    ? await Promise.all([searchTeam(input.home), searchTeam(input.away)])
    : [null, null];
  const homeApiId = homeMatch?.id ?? null;
  const awayApiId = awayMatch?.id ?? null;

  // Prefer the API's own spelling over what was typed/AI-generated, but only
  // when the lookup was unambiguous — an unconfident match is more likely to
  // be the wrong team than a useful correction. See searchTeam's TeamSearchResult.
  const homeTeamName = homeMatch?.confident ? homeMatch.name : input.home;
  const awayTeamName = awayMatch?.confident ? awayMatch.name : input.away;

  const [homeContext, awayContext, standings, h2h] = await Promise.all([
    homeApiId && input.leagueApiId ? getTeamContext(homeApiId, input.leagueApiId, season) : Promise.resolve(null),
    awayApiId && input.leagueApiId ? getTeamContext(awayApiId, input.leagueApiId, season) : Promise.resolve(null),
    input.leagueApiId ? getStandings(input.leagueApiId, season) : Promise.resolve(null),
    homeApiId && awayApiId ? getHeadToHead(homeApiId, awayApiId) : Promise.resolve(null),
  ]);

  const output = await generatePredictionForFixture({
    home: input.home,
    away: input.away,
    league: input.league,
    kickoff: input.kickoff,
    homeContext,
    awayContext,
    standings,
    h2h,
  });

  // A league was specified (live context was expected) but every source —
  // team form/injuries/stats for both sides, standings, and h2h — came back
  // empty. Usually means the football API failed silently (bad key, plan
  // restriction, rate limit) rather than the fixture genuinely having no data.
  const contextComplete = !input.leagueApiId
    ? true
    : !(isTeamContextEmpty(homeContext) && isTeamContextEmpty(awayContext) && !standings && (!h2h || h2h.length === 0));

  const job = await prisma.aIJob.create({
    data: {
      userId: input.authorId,
      prompt: JSON.stringify(input),
      model: process.env.GEMINI_MODEL || "gemini-flash-latest",
      rawOutput: JSON.stringify(output),
      status: "COMPLETED",
      contextComplete,
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
          contextComplete,
          authorId: input.authorId,
          aiJobId: job.id,
        },
      });
      await setPredictionCategories(pred.id, input.categories);
      return pred;
    }),
  );

  return { job, preview: output.matchPreview, predictions: created };
}
