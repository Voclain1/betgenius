import { prisma } from "@/lib/prisma";
import { lagosDateKey } from "@/lib/lagosDate";
import { QUOTA_EXPERIMENT, quotaExperimentConfig, reliableUsageCost, experimentalDays, type RichnessFixture, type QuotaExperimentConfig, withQuotaExperiment } from "@/lib/vipQuotaExperiment";
import { attemptKickoffDay, readVipPremiumAttempt, type VipPremiumTarget } from "@/lib/vipPremiumOverlay";
import { lagosTodayBounds } from "@/lib/lagosDate";

/** Reservations are retained on crash/failure; writes serialize across instances. */
export async function reserveExtraAttempt(target: VipPremiumTarget, config: QuotaExperimentConfig, eligibleFixtures: readonly RichnessFixture[], now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(760016)`;
    // Re-read the switch and pricing expiry at the actual reservation. API
    // consumption is separately reserved per dispatch in football/usage.ts.
    const current = quotaExperimentConfig(process.env, now);
    if (!current || JSON.stringify(current) !== JSON.stringify(config)) return null;
    // The extra allowance must never re-buy a baseline fixture rescheduled
    // beyond the ordinary four-day accounting lookback. Parse exact ids after
    // the SQL prefilter, since textual id prefixes can also match larger ids.
    const historical = await tx.aIJob.findMany({
      where: { AND: [
        { prompt: { contains: '\"intent\":\"VIP_PREMIUM\"' } },
        { prompt: { contains: `"fixtureApiId":${target.fixtureApiId}` } },
      ] }, select: { prompt: true, createdAt: true },
    });
    if (historical.some(j => readVipPremiumAttempt(j.prompt, j.createdAt)?.fixtureApiId === target.fixtureApiId)) return null;
    const all = await tx.paidQuotaAttempt.findMany();
    const { start, end } = lagosTodayBounds(now);
    const jobs = await tx.aIJob.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 4 * 86400_000) }, prompt: { contains: '"intent":"VIP_PREMIUM"' } }, select: { prompt: true, createdAt: true } });
    const attempts = jobs.map(j => readVipPremiumAttempt(j.prompt, j.createdAt)).filter(a => a !== null);
    if (attempts.some(a => a.fixtureApiId === target.fixtureApiId) || all.some(a => a.fixtureApiId === target.fixtureApiId)) return null;
    const kickoffDay = lagosDateKey(target.kickoff), spendDay = lagosDateKey(now);
    const missing = all.filter(a => !attempts.some(j => j.fixtureApiId === a.fixtureApiId));
    // Reconcile the selector's eligible pool with identities re-read under the
    // reservation lock. Records still count separately toward the spend caps.
    const identities = [
      ...attempts.map(a => ({ day: attemptKickoffDay(a), fixtureApiId: a.fixtureApiId })),
      ...missing.map(a => ({ day: a.kickoffDay, fixtureApiId: a.fixtureApiId })),
    ];
    if (!eligibleFixtures.some(c => c.day === kickoffDay && c.fixtureApiId === target.fixtureApiId)
      || !experimentalDays(identities, eligibleFixtures, config.extra).has(kickoffDay)) return null;
    const kickoffCount = attempts.filter(a => attemptKickoffDay(a) === kickoffDay).length + missing.filter(a => a.kickoffDay === kickoffDay).length;
    const spendCount = attempts.filter(a => a.createdAt >= start && a.createdAt < end).length + missing.filter(a => a.spendDay === spendDay).length;
    const today = all.filter(a => a.spendDay === spendDay);
    if (kickoffCount < 8 || kickoffCount >= 8 + config.extra || spendCount >= 12 || today.some(a => a.modelRequests > 0 && !a.usageReliable) || today.reduce((s,a) => s+a.reservedMicroUsd,0)+config.reservationMicroUsd > config.dailyMicroUsd) return null;
    if (target.kickoff.getTime() <= now.getTime()) return null;
    return tx.paidQuotaAttempt.create({ data: { fixtureApiId: target.fixtureApiId, experiment: QUOTA_EXPERIMENT, kickoffDay, spendDay, reservedMicroUsd: config.reservationMicroUsd, configJson: JSON.stringify(config) } });
  });
}

export function runExtraAttempt<T>(fixtureApiId: number, config: QuotaExperimentConfig, fn: () => Promise<T>) {
  return withQuotaExperiment({
    config,
    beforeModel: async () => {
      if (JSON.stringify(quotaExperimentConfig()) !== JSON.stringify(config)) throw new Error("quota experiment disabled or price attestation expired");
      const r = await prisma.paidQuotaAttempt.updateMany({ where: { fixtureApiId, modelRequests: 0, spendDay: lagosDateKey(new Date()) }, data: { modelRequests: 1 } });
      if (r.count !== 1) throw new Error("quota experiment: model request already reserved/spent");
    },
    afterModel: async (model, usage) => {
      const actualMicroUsd = reliableUsageCost(config, model, usage);
      await prisma.paidQuotaAttempt.update({ where: { fixtureApiId }, data: { actualMicroUsd, usageReliable: actualMicroUsd !== null } });
      if (actualMicroUsd === null) throw new Error("quota experiment: unreliable model usage; remaining extras blocked");
    },
    recordApi: async () => { await prisma.paidQuotaAttempt.update({ where: { fixtureApiId }, data: { apiCalls: { increment: 1 } } }); },
  }, fn);
}
