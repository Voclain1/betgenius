import { getFixturesByLeague } from "../src/lib/football/api-football";
import { buildGenerationDigest } from "../src/lib/ai/generationContext";
import { generatePredictionForFixture } from "../src/lib/ai/analysis";
import { resolveGenerationRisk } from "../src/lib/ai/generationRisk";
import { deriveMarketAndPick } from "../src/lib/markets";
import { prisma } from "../src/lib/prisma";

async function main() {
  const current = (await getFixturesByLeague(81, 2026)) ?? [];
  const historical = current.length ? current : ((await getFixturesByLeague(81, 2025)) ?? []);
  const fixture = historical.find((row) => row.fixture.status.short === "NS") ?? historical[0];
  if (!fixture) throw new Error("No real DFB Pokal fixture available for the sample");

  const { digest } = await buildGenerationDigest({
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    league: fixture.league.name,
    kickoff: fixture.fixture.date,
    homeApiId: fixture.teams.home.id,
    awayApiId: fixture.teams.away.id,
    leagueApiId: fixture.league.id,
    round: fixture.league.round ?? null,
  });
  const route = resolveGenerationRisk(["FEATURED"], fixture.league.id);
  const generated = await generatePredictionForFixture({ digest, tiers: route.promptTiers });
  if (!generated.model.startsWith("gemini:")) throw new Error(`Gemini did not answer: ${generated.model}`);
  const prediction = generated.output.predictions[0];
  const display = deriveMarketAndPick(prediction.marketType, prediction.selection, fixture.teams.home.name, fixture.teams.away.name);

  console.log(JSON.stringify({
    persisted: false,
    fixture: `${fixture.teams.home.name} vs ${fixture.teams.away.name}`,
    kickoff: fixture.fixture.date,
    fixtureStatusAtSample: fixture.fixture.status.short,
    competition: fixture.league.name,
    round: fixture.league.round,
    digestCompetitionType: digest.fixture.competitionType,
    standings: digest.standings,
    standingsCoverage: digest.coverage.standings,
    calibration: route.calibration,
    model: generated.model,
    market: display.market,
    pick: display.pick,
    confidence: prediction.confidence,
    reasoning: prediction.reasoning,
    mentionsStandingsOrPosition: /standings|league position|table position|\b\d+(st|nd|rd|th) place\b/i.test(prediction.reasoning),
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
