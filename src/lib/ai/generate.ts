import { prisma } from "@/lib/prisma";
import { generatePredictionForFixture } from "@/lib/ai/gemini";
import { getTeamContext, getStandings, getHeadToHead, searchTeam, resolveSeason } from "@/lib/football/api-football";
import { setPredictionCategories } from "@/lib/predictions";

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
export async function generateAndPersistPrediction(input: GenerateFixtureInput) {
  // Resolve from the fixture's own kickoff date/league, not "today" — a
  // February fixture belongs to the season that started the previous August.
  const kickoffDate = new Date(input.kickoff);
  const season = input.leagueApiId
    ? await resolveSeason(input.leagueApiId, isNaN(kickoffDate.getTime()) ? new Date() : kickoffDate)
    : new Date().getFullYear();

  // Best-effort: resolve team ids from names so we can pull live context.
  // Falls back to null context (model reasons from names alone) if lookup fails.
  const [homeApiId, awayApiId] = input.leagueApiId
    ? await Promise.all([
        searchTeam(input.home, input.leagueApiId, season),
        searchTeam(input.away, input.leagueApiId, season),
      ])
    : [null, null];

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
      const pred = await prisma.prediction.create({
        data: {
          fixtureId: input.fixtureId,
          category: input.categories[0],
          leagueApiId: input.leagueApiId,
          leagueName: input.league,
          homeTeam: input.home,
          awayTeam: input.away,
          kickoff: isNaN(kickoffDate.getTime()) ? undefined : kickoffDate,
          status: "PENDING_REVIEW",
          market: p.market,
          pick: p.pick,
          overUnder: p.overUnder,
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
