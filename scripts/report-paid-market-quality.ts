import { verifiedEntryPrice } from "../src/lib/paidEntryEvidence";
import { evaluateShadowSegmentPolicy } from "../src/lib/paidHoldoutPolicy";
/**
 * Read-only VIP Sprint 04 market-quality report.
 *
 * Run with an explicitly read-only PostgreSQL role:
 * REQUIRE_READ_ONLY=1 npx tsx --env-file=.env scripts/report-paid-market-quality.ts
 *
 * Historical entry odds are used ONLY when frozen at publication. Cached
 * closing odds are intentionally not reconstructed as entry odds.
 */
export {};
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { chronologicalHoldout, validationWarnings } from "../src/lib/paidChronologicalValidation";
import { segmentPaidPerformance, type SegmentDimension, type SettledPaidObservation } from "../src/lib/paidMarketQuality";

const DAY = 86_400_000;
async function main() {
  if (process.env.REQUIRE_READ_ONLY !== "1") throw new Error("Set REQUIRE_READ_ONLY=1 and use a read-only database role");
  const [state] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
  if (state?.transaction_read_only !== "on") throw new Error("Refusing to run without read-only PostgreSQL transaction");
  const days = Math.min(365, Math.max(1, Number(process.argv[2]) || 90));
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY);
  const rows = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      kickoff: { gte: since, lt: now },
      outcome: { in: ["WON", "LOST", "VOID"] },
      categories: { some: { category: { in: ["VIP", "PREMIUM"] } } },
    },
    select: {
      id: true, kickoff: true, marketType: true, leagueApiId: true,
      confidence: true, outcome: true, marketConfirmation: true,
      aiJob: { select: { model: true } },
      categories: { select: { category: true } },
    },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
  });
  const observations: SettledPaidObservation[] = rows.filter(r => r.kickoff).map(r => {
    const odds = verifiedEntryPrice(r.marketConfirmation, r.kickoff!);
    return {
      id: r.id, kickoff: r.kickoff!, marketType: r.marketType,
      leagueApiId: r.leagueApiId, provider: (r.marketConfirmation && typeof r.marketConfirmation === "object" && !Array.isArray(r.marketConfirmation) && typeof (r.marketConfirmation as Record<string, unknown>).provider === "string") ? (r.marketConfirmation as Record<string, unknown>).provider as string : null,
      odds, priceSource: odds === null ? "missing" : "entry",
      confidence: r.confidence, outcome: r.outcome as "WON" | "LOST" | "VOID",
    };
  });
  const dimensions: SegmentDimension[] = ["market", "league", "provider", "oddsBand", "confidenceBand"];
  const output = {
    generatedAt: now.toISOString(),
    windowDays: days,
    selection: "published VIP or Premium, settled, kickoff in past",
    pricePolicy: "frozen entry price only; never substitute closing or post-kickoff odds",
    selectionPolicy: "diagnostic only; no live rules activated",
    observations: observations.length,
    entryPriced: observations.filter(r => r.priceSource === "entry").length,
    missingEntryPrice: observations.filter(r => r.priceSource === "missing").length,
    dimensions: Object.fromEntries(dimensions.map(d => [d, segmentPaidPerformance(observations, d)])),
    chronologicalHoldout: Object.fromEntries(dimensions.map(d => { const result = chronologicalHoldout(observations, d); return [d, { ...result, warnings: validationWarnings(result) }]; })),
    shadowPolicyComparisons: Object.fromEntries(dimensions.map(d => [d, evaluateShadowSegmentPolicy(observations, d)])),
  };
  console.log(JSON.stringify(output, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
