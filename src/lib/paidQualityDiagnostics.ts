import { verifiedEntryPrice } from "@/lib/paidEntryEvidence";
import { prisma } from "@/lib/prisma";
import { segmentPaidPerformance, type SegmentDimension, type SettledPaidObservation } from "@/lib/paidMarketQuality";
import { chronologicalHoldout, validationWarnings } from "@/lib/paidChronologicalValidation";

/** Admin-only caller. Read-only; never interprets missing odds as a quoted price. */
export async function loadPaidQualityDiagnostics(days = 90) {
  const boundedDays = Math.min(365, Math.max(1, Math.floor(days)));
  const now = new Date();
  const since = new Date(now.getTime() - boundedDays * 86_400_000);
  const raw = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED", kickoff: { gte: since, lt: now },
      outcome: { in: ["WON", "LOST", "VOID"] },
      categories: { some: { category: { in: ["VIP", "PREMIUM"] } } },
    },
    select: {
      id: true, kickoff: true, marketType: true, leagueApiId: true,
      confidence: true, outcome: true, marketConfirmation: true,
    },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
  });
  const observations: SettledPaidObservation[] = raw.filter(r => r.kickoff).map(r => {
    const odds = verifiedEntryPrice(r.marketConfirmation, r.kickoff!);
    return {
      id: r.id, kickoff: r.kickoff!, marketType: r.marketType,
      leagueApiId: r.leagueApiId, provider: null, // No verified bookmaker identifier is stored with this historical quote.
      odds, priceSource: odds === null ? "missing" : "entry",
      confidence: r.confidence, outcome: r.outcome as "WON" | "LOST" | "VOID",
    };
  });
  const dimensions: SegmentDimension[] = ["market", "league", "provider", "oddsBand", "confidenceBand"];
  return {
    days: boundedDays, total: observations.length,
    priced: observations.filter(r => r.priceSource === "entry").length,
    dimensions: dimensions.map(dimension => {
      const holdout = chronologicalHoldout(observations, dimension);
      return {
        dimension, segments: segmentPaidPerformance(observations, dimension),
        holdout: { trainingCount: holdout.trainingCount, validationCount: holdout.validationCount,
          splitAt: holdout.splitAt, warnings: validationWarnings(holdout) },
      };
    }),
  };
}
