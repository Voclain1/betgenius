/** Read-only production evaluation; no provider imports/calls, never settle or publish. */
export {};
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;
import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import { PAID_CORE_LEAGUE_IDS } from "../src/lib/vipPremiumOverlay";

async function main() {
  if (process.env.REQUIRE_READ_ONLY !== "1") throw new Error("REQUIRE_READ_ONLY=1 required");
  const [ro] = await prisma.$queryRawUnsafe<{transaction_read_only:string}[]>("SHOW transaction_read_only");
  if (ro?.transaction_read_only !== "on") throw new Error("database session must be read-only");
  const days = Math.min(90, Math.max(1, Number(process.argv[2]) || 30));
  const since = new Date(Date.now() - days * 86400_000);
  const [extras, jobs, usage, ledger] = await Promise.all([
    prisma.paidQuotaAttempt.findMany({ where: { createdAt: { gte: since } } }),
    prisma.aIJob.findMany({ where: { createdAt: { gte: since }, prompt: { contains: '"intent":"VIP_PREMIUM"' } }, include: { predictions: { include: { categories: true } } } }),
    prisma.apiUsage.findMany({ where: { day: { gte: since.toISOString().slice(0,10) } } }),
    prisma.generationAttempt.findMany({ where: { kickoff: { gte: since }, leagueApiId: { in: [...PAID_CORE_LEAGUE_IDS] } }, select: { kickoff: true } }),
  ]);
  const coreDays = new Set(ledger.filter(l => l.kickoff).map(l => lagosDateKey(l.kickoff!)));
  const breakDays = new Set((process.env.VIP_QUOTA_BREAK_DAYS ?? "").split(",").filter(Boolean));
  const cohorts = new Map<string, any>();
  for (const job of jobs) {
    let prompt; try { prompt = JSON.parse(job.prompt); } catch { continue; }
    const day = lagosDateKey(prompt.kickoff ?? job.createdAt);
    // Core-free is a measurable proxy; operator must annotate international breaks.
    const calendar = breakDays.has(day) ? "international-break" : coreDays.has(day) ? "core-calendar" : "core-free (calendar unclassified)";
    const extra = extras.find(e => e.fixtureApiId === prompt.fixtureApiId);
    const key = `${day}|${calendar}|${extra ? "extra" : "unchanged-baseline"}`;
    const r = cohorts.get(key) ?? { day, calendar, arm: extra ? "extra" : "unchanged-baseline", attempts: 0, vipPromotions: 0, premiumPromotions: 0, published: 0, postKickoff: 0, duplicateFixtures: 0, wins: 0, losses: 0, voids: 0, pending: 0, brierSum: 0, settled: 0, fixtures: new Set<number>(), promotedFixtures: new Set<number>() };
    r.attempts++;
    for (const p of job.predictions) {
      const cats = p.categories.map(c => c.category);
      if (!cats.includes("VIP") && !cats.includes("PREMIUM")) continue;
      if (p.fixtureApiId != null) r.promotedFixtures.add(p.fixtureApiId);
      r.vipPromotions++; if (cats.includes("PREMIUM")) r.premiumPromotions++;
      if (!p.publishedAt) continue;
      r.published++;
      if (!p.kickoff || p.publishedAt >= p.kickoff) r.postKickoff++;
      if (r.fixtures.has(p.fixtureApiId)) r.duplicateFixtures++;
      r.fixtures.add(p.fixtureApiId);
      if (p.outcome === "WON" || p.outcome === "LOST") {
        const won = p.outcome === "WON"; r[won ? "wins" : "losses"]++; r.settled++;
        r.brierSum += (p.confidence / 100 - Number(won)) ** 2;
      } else r[p.outcome === "VOID" ? "voids" : "pending"]++;
    }
    cohorts.set(key,r);
  }
  const extraIds = new Set(extras.map(e => e.fixtureApiId));
  const additionalQualifyingFixtures = new Set(jobs.filter(j => extraIds.has((() => { try { return JSON.parse(j.prompt).fixtureApiId; } catch { return null; } })())).flatMap(j => j.predictions.filter(p => p.categories.some(c => c.category === "VIP" || c.category === "PREMIUM")).map(p => p.fixtureApiId))).size;
  const reservedUsd = extras.reduce((s,e) => s+e.reservedMicroUsd,0)/1e6;
  const actualUsd = extras.every(e => e.modelRequests === 0 || e.usageReliable) ? extras.reduce((s,e) => s+(e.actualMicroUsd ?? 0),0)/1e6 : null;
  console.log(JSON.stringify({
    additionalQualifyingFixtures,
    marginalReservedUsdPerQualifyingPromotion: additionalQualifyingFixtures ? reservedUsd/additionalQualifyingFixtures : null,
    marginalRecordedUsdPerQualifyingPromotion: additionalQualifyingFixtures && actualUsd !== null ? actualUsd/additionalQualifyingFixtures : null,
    since, note: "Extra-vs-baseline attribution is measured, not a randomized causal uplift estimate. PREMIUM is a subset of VIP. Cost denominators count unique VIP-or-better fixtures. Reserved cost includes failures. No refunds for missing usage.",
    cohorts: [...cohorts.values()].map(({ fixtures, promotedFixtures, brierSum, ...r }) => ({ ...r, uniquePromotedFixtures: promotedFixtures.size, uniquePublishedFixtures: fixtures.size, brier: r.settled ? brierSum/r.settled : null })),
    additionalAttemptsReserved: extras.length,
    additionalModelRequests: extras.reduce((s,e) => s+e.modelRequests,0),
    incrementalReservedUsd: extras.reduce((s,e) => s+e.reservedMicroUsd,0)/1e6,
    incrementalRecordedUsd: extras.every(e => e.modelRequests === 0 || e.usageReliable) ? extras.reduce((s,e) => s+(e.actualMicroUsd ?? 0),0)/1e6 : null,
    unmeteredAttempts: extras.filter(e => e.modelRequests && !e.usageReliable).length,
    additionalApiCalls: extras.reduce((s,e) => s+e.apiCalls,0),
    reservations: extras,
    apiByUtcDay: usage.reduce<Record<string,number>>((out,r) => { out[r.day]=(out[r.day]??0)+r.count; return out; },{}),
  }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode=1; }).finally(() => prisma.$disconnect());
