import { prisma } from "../src/lib/prisma";
import { parseStoredContext } from "../src/lib/ai/context";
import {
  generatePredictionForFixture,
  type AIPredictionOutput,
} from "../src/lib/ai/analysis";
import { deriveMarketAndPick } from "../src/lib/markets";
import { resolveGenerationRisk } from "../src/lib/ai/generationRisk";
import { leaguePriorityRank } from "../src/lib/leagues";

type Candidate = Awaited<ReturnType<typeof loadCandidates>>[number];

async function loadCandidates() {
  return prisma.prediction.findMany({
    where: { aiJob: { isNot: null } },
    orderBy: { createdAt: "desc" },
    take: 250,
    select: {
      id: true,
      homeTeam: true,
      awayTeam: true,
      leagueName: true,
      leagueApiId: true,
      confidence: true,
      aiJob: { select: { context: true } },
    },
  });
}

function firstPick(output: AIPredictionOutput, home: string, away: string) {
  const p = output.predictions[0];
  if (!p) throw new Error("Model returned no prediction");
  const display = deriveMarketAndPick(p.marketType, p.selection, home, away, { market: p.marketType, pick: JSON.stringify(p.selection) });
  return {
    market: display.market,
    pick: display.pick,
    confidence: Math.round(p.confidence),
    reasoning: p.reasoning,
  };
}

async function compare(row: Candidate, intendedCategories: string[], fixtureType: string) {
  const digest = parseStoredContext(row.aiJob?.context);
  if (!digest) throw new Error(`Stored digest unavailable for ${row.id}`);

  const route = resolveGenerationRisk(intendedCategories, row.leagueApiId);

  const before = await generatePredictionForFixture({ digest, tiers: route.promptTiers, riskCalibration: false });
  const after = await generatePredictionForFixture({
    digest,
    tiers: route.promptTiers,
    riskCalibration: route.calibration !== "legacy",
  });
  if (!before.model.startsWith("gemini:") || !after.model.startsWith("gemini:")) {
    throw new Error(`Gemini did not answer both calls: ${before.model}, ${after.model}`);
  }

  return {
    fixtureType,
    intendedCategories,
    resolvedCalibration: route.calibration,
    routingReason: route.reason,
    fixture: `${row.homeTeam} vs ${row.awayTeam}`,
    league: row.leagueName,
    priorStoredConfidence: row.confidence,
    model: after.model,
    before: firstPick(before.output, row.homeTeam ?? "Home", row.awayTeam ?? "Away"),
    after: firstPick(after.output, row.homeTeam ?? "Home", row.awayTeam ?? "Away"),
  };
}

async function main() {
  const rows = await loadCandidates();
  const used = new Set<string>();
  const take = (predicate: (row: Candidate) => boolean) => {
    const row = rows.find((candidate) => !used.has(candidate.id) && !!candidate.aiJob?.context && predicate(candidate));
    if (!row) throw new Error("Could not find a real stored fixture for one of the requested sample bands");
    used.add(row.id);
    return row;
  };

  // Stored confidence is used only to obtain a practical spread of fixture
  // shapes; both comparison calls re-analyse the exact same stored evidence.
  const samples = [
    await compare(
      take((r) => leaguePriorityRank(r.leagueApiId) < 12 && r.confidence >= 68),
      ["FEATURED"],
      "top-priority league proxy",
    ),
    await compare(
      take((r) => leaguePriorityRank(r.leagueApiId) >= 12 && r.confidence >= 68),
      ["FEATURED"],
      "lower-priority league baseline",
    ),
    await compare(
      take((r) => r.confidence >= 75),
      ["BANKER"],
      "BANKER-intended control",
    ),
  ];
  console.log(JSON.stringify(samples, null, 2));
}

main().finally(() => prisma.$disconnect());
