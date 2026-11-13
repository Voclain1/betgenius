import { auditPublicationQuoteEvidence } from "../src/lib/paidEntryEvidence";
import { assessPaidEvidenceReadiness } from "../src/lib/paidEvidenceGate";
import { evaluateShadowSegmentPolicy } from "../src/lib/paidHoldoutPolicy";
/**
 * Read-only VIP Sprint 04 market-quality report.
 *
 * Run with an explicitly read-only PostgreSQL role:
 * REQUIRE_READ_ONLY=1 npx tsx --env-file=.env scripts/report-paid-market-quality.ts
 *
 * Only attributed publication-time indicative odds are eligible. Cached
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
      categories: { select: { category: true } },
    },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
  });
  const observations: SettledPaidObservation[] = rows.filter(r => r.kickoff).map(r => {
    const publicationAudit = auditPublicationQuoteEvidence(r.marketConfirmation, r.kickoff!);
    const odds = publicationAudit.usable && 'price' in publicationAudit ? publicationAudit.price ?? null : null;
    return {
      id: r.id, kickoff: r.kickoff!, marketType: r.marketType,
      leagueApiId: r.leagueApiId, provider: null, // No verified bookmaker identifier is stored with this historical quote.
      odds, priceSource: odds === null ? "missing" : "entry",
      confidence: r.confidence, outcome: r.outcome as "WON" | "LOST" | "VOID",
    };
  });
  const dimensions: SegmentDimension[] = ["market", "league", "provider", "oddsBand", "confidenceBand"];
  const output = {
    generatedAt: now.toISOString(),
    windowDays: days,
    selection: "published VIP or Premium, settled, kickoff in past",
    pricePolicy: "named-bookmaker indicative publication snapshot only; never substitute promotion, closing or post-kickoff odds; not an executed fill",
    selectionPolicy: "diagnostic only; no live rules activated",
    observations: observations.length,
    publicationEvidencePriced: observations.filter(r => r.priceSource === "entry").length,
    missingPublicationEvidence: observations.filter(r => r.priceSource === "missing").length,
    publicationEvidenceReasons: rows.reduce<Record<string, number>>((counts, r) => {
      if (!r.kickoff) return counts;
      const reason = auditPublicationQuoteEvidence(r.marketConfirmation, r.kickoff).reason;
      counts[reason] = (counts[reason] ?? 0) + 1;
      return counts;
    }, {}),
    dimensions: Object.fromEntries(dimensions.map(d => [d, segmentPaidPerformance(observations, d)])),
    chronologicalHoldout: Object.fromEntries(dimensions.map(d => { const result = chronologicalHoldout(observations, d); return [d, { ...result, warnings: validationWarnings(result) }]; })),
    shadowPolicyComparisons: Object.fromEntries(dimensions.map(d => [d, evaluateShadowSegmentPolicy(observations, d)])),
    evidenceReadiness: assessPaidEvidenceReadiness(observations, dimensions.map(d => evaluateShadowSegmentPolicy(observations, d))),
  };
  console.log(JSON.stringify(output, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
