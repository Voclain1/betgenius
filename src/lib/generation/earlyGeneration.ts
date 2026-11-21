/**
 * Distinct early free-generation pass. Ordinary 48h generation retains priority
 * and its own adaptive combo mix; this pass creates singles destined for public
 * pages 2–14 days before kickoff, without touching VIP/Premium targeting.
 */
import { prisma } from "@/lib/prisma";
import { runGeneration } from "@/lib/generation/worker";
import { withNoFootballApiCalls } from "@/lib/football/api-football";
import { EARLY_FIXTURE_POLICY, earlyFixtureMode, inEarlyGenerationWindow } from "@/lib/generation/earlyFixturePolicy";
import { EARLY_FREE_GENERATION_INTENT } from "@/lib/ai/generationRisk";
import { earlyFixturePricedForGeneration } from "@/lib/generation/earlyOddsPolicy";
import type { FixtureOdds } from "@/lib/odds";

export type EarlyGenerationResult = {
  ok: boolean; skipped?: string; selected: number; generated: number; pricedSelected?: number; unpricedSelected?: number; summary: string;
  worker?: Awaited<ReturnType<typeof runGeneration>>;
};

export async function runEarlyFreeGeneration(input: { actorId: string; now?: Date; limit?: number }): Promise<EarlyGenerationResult> {
  const now = input.now ?? new Date();
  if (earlyFixtureMode() !== "on") return { ok: true, skipped: "early fixture mode is not on", selected: 0, generated: 0, summary: "Early generation disabled" };
  // Operational batch size, not a daily/league generation quota. The queue
  // resumes on every cron pass, protecting the regular and paid workflows.
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
    // No top-400 ledger ceiling: every captured fixture eventually gets a turn.
  });
  const pending = queued.filter(a => inEarlyGenerationWindow(a.kickoff, now, a.leagueApiId)
    && (a.status === "PENDING" || (a.nextAttemptAt && a.nextAttemptAt <= now)));
  const cached = pending.length ? await prisma.upcomingFixture.findMany({
    where: { fixtureApiId: { in: pending.map(a => a.fixtureApiId!) },
      earlyQueuedAt: { not: null }, status: "NS" },
    select: { fixtureApiId: true, kickoff: true },
  }) : [];
  const valid = new Map(cached.map(c => [c.fixtureApiId, c]));
  const eligible = pending.filter(a => {
    const item = valid.get(a.fixtureApiId!);
    return item && Math.abs(item.kickoff.getTime() - a.kickoff.getTime()) <= 15 * 60_000;
  });
  const quotes = eligible.length ? await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: eligible.map(a => a.matchKey) } },
    select: { matchKey: true, oddsJson: true, fetchedAt: true },
  }) : [];
  const byKey = new Map(quotes.map(q => [q.matchKey, q]));
  // Quote-first, NOT quote-only: unpriced fixtures must still be analysed,
  // held if weak, or sent to normal editorial review if credible. Only the
  // later atomic publication step requires an exact, fresh bookmaker quote.
  const priced: typeof eligible = [];
  const unpriced: typeof eligible = [];
  for (const a of eligible) {
    const quote = byKey.get(a.matchKey);
    const hasPrice = earlyFixturePricedForGeneration({
      odds: (quote?.oddsJson as FixtureOdds | null) ?? null,
      fetchedAt: quote?.fetchedAt ?? null, kickoff: a.kickoff, now,
    });
    (hasPrice ? priced : unpriced).push(a);
  }
  const chosen = [...priced, ...unpriced].slice(0, limit);
  const keys = chosen.map(a => a.matchKey);
  const pricedSelected = chosen.filter(a => priced.includes(a)).length;
  if (!keys.length) return { ok: true, skipped: "no available early fixtures",
    selected: 0, generated: 0, pricedSelected: 0, unpricedSelected: 0,
    summary: "Early generation found no pending captured fixtures" };
  const worker = await withNoFootballApiCalls(() => runGeneration({
    authorId: input.actorId, categories: ["FEATURED"], matchKeys: keys,
    intent: EARLY_FREE_GENERATION_INTENT,
    limit: keys.length, now,
    // Never pass adaptiveCombo: early tips are standalone selections.
  }));
  return { ok: worker.ok, selected: keys.length, generated: worker.predictionsCreated,
    pricedSelected, unpricedSelected: keys.length - pricedSelected,
    summary: "Early free generation selected " + keys.length + " (" + pricedSelected +
      " priced, " + (keys.length - pricedSelected) + " awaiting quotes), created " + worker.predictionsCreated,
    worker };
}
