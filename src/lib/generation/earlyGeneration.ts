/**
 * Distinct early free-generation pass. Ordinary 48h generation retains priority
 * and its own adaptive combo mix; this pass creates singles destined for public
 * pages 2–14 days before kickoff, without touching VIP/Premium targeting.
 */
import { prisma } from "@/lib/prisma";
import { getUsageSnapshot } from "@/lib/football/usage";
import { runGeneration } from "@/lib/generation/worker";
import { EARLY_FIXTURE_POLICY, earlyFixtureMode, inEarlyGenerationWindow } from "@/lib/generation/earlyFixturePolicy";
import { EARLY_FREE_GENERATION_INTENT } from "@/lib/ai/generationRisk";

const MIN_API_HEADROOM = 1_800;
export type EarlyGenerationResult = {
  ok: boolean; skipped?: string; selected: number; generated: number; summary: string;
  worker?: Awaited<ReturnType<typeof runGeneration>>;
};

export async function runEarlyFreeGeneration(input: { actorId: string; now?: Date; limit?: number }): Promise<EarlyGenerationResult> {
  const now = input.now ?? new Date();
  if (earlyFixtureMode() !== "on") return { ok: true, skipped: "early fixture mode is not on", selected: 0, generated: 0, summary: "Early generation disabled" };
  const quota = await getUsageSnapshot();
  if (quota.remaining < MIN_API_HEADROOM) return { ok: true, skipped: "preserving provider quota", selected: 0, generated: 0, summary: "Early generation deferred for quota" };
  const limit = Math.max(1, Math.min(4, Math.trunc(input.limit ?? 3)));
  const from = new Date(now.getTime() + 48 * 3_600_000);
  const until = new Date(now.getTime() + EARLY_FIXTURE_POLICY.EARLY_GENERATION_UNTIL_HOURS * 3_600_000);
  const queued = await prisma.generationAttempt.findMany({
    where: {
      kickoff: { gt: from, lte: until }, status: { in: ["PENDING", "FAILED"] },
      fixtureApiId: { not: null },
    },
    select: { matchKey: true, fixtureApiId: true, leagueApiId: true, kickoff: true, status: true, nextAttemptAt: true },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    take: 80,
  });
  const pending = queued.filter(a => inEarlyGenerationWindow(a.kickoff, now, a.leagueApiId)
    && (a.status === "PENDING" || (a.nextAttemptAt && a.nextAttemptAt <= now)));
  const cached = pending.length ? await prisma.upcomingFixture.findMany({
    where: { fixtureApiId: { in: pending.map(a => a.fixtureApiId!) },
      earlyQueuedAt: { not: null }, status: "NS" },
    select: { fixtureApiId: true, kickoff: true },
  }) : [];
  const valid = new Map(cached.map(c => [c.fixtureApiId, c]));
  const keys = pending.filter(a => {
    const item = valid.get(a.fixtureApiId!);
    return item && Math.abs(item.kickoff.getTime() - a.kickoff.getTime()) <= 15 * 60_000;
  }).slice(0, limit).map(a => a.matchKey);
  if (!keys.length) return { ok: true, skipped: "no qualified queued early fixtures", selected: 0, generated: 0, summary: "Early generation found no pending fixtures" };
  const worker = await runGeneration({
    authorId: input.actorId, categories: ["FEATURED"], matchKeys: keys,
    intent: EARLY_FREE_GENERATION_INTENT,
    limit: keys.length, now,
    // Never pass adaptiveCombo: early tips are standalone selections.
  });
  return { ok: worker.ok, selected: keys.length, generated: worker.predictionsCreated,
    summary: "Early free generation selected " + keys.length + ", created " + worker.predictionsCreated,
    worker };
}
