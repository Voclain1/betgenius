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
import { filterSelectiveQueuedCandidates } from "@/lib/generation/selectiveLeagues";

/**
 * Kickoff-distance bands, in the order the early lane serves unpriced work.
 * The lane exists to assess fixtures 3–7 days out; serving strictly by soonest
 * kickoff meant a backlog was always worked at 48–72h and the 4–7 day target
 * was reached only when the queue was empty. Priced fixtures still go first,
 * and nothing is dropped: a fixture not reached early is taken by ordinary
 * generation inside 48h exactly as before.
 */
export function earlyLeadBand(kickoff: Date, now: Date): "48-72h" | "3-7d" | "7-14d" {
  const h = (kickoff.getTime() - now.getTime()) / 3_600_000;
  return h <= 72 ? "48-72h" : h <= 168 ? "3-7d" : "7-14d";
}
const BAND_ORDER: Record<ReturnType<typeof earlyLeadBand>, number> = { "3-7d": 0, "48-72h": 1, "7-14d": 2 };

/** Pure ordering, unit-checked: priced first, then the 3–7 day target band, then soonest kickoff. */
export function orderEarlyQueue<T extends { kickoff: Date; matchKey: string }>(items: readonly T[], pricedKeys: ReadonlySet<string>, now: Date): T[] {
  return [...items].sort((a, b) =>
    Number(!pricedKeys.has(a.matchKey)) - Number(!pricedKeys.has(b.matchKey))
    || BAND_ORDER[earlyLeadBand(a.kickoff, now)] - BAND_ORDER[earlyLeadBand(b.kickoff, now)]
    || a.kickoff.getTime() - b.kickoff.getTime()
    || a.matchKey.localeCompare(b.matchKey));
}

/** A selective-league fixture with no usable cached table is retried after this long, without counting an attempt. */
export const EARLY_SELECTIVE_DEFER_MS = 6 * 3_600_000;

export type EarlyGenerationResult = {
  ok: boolean; skipped?: string; selected: number; generated: number; pricedSelected?: number; unpricedSelected?: number; summary: string;
  /** Queue depth by kickoff band at the start of the run — the backlog signal. */
  queueByBand?: Record<string, { eligible: number; priced: number }>;
  /** Fixtures deferred (not counted as attempts) because the selective-league gate could not be evaluated from cache. */
  deferredSelective?: number;
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
  // The selective-league (strongest-clubs) gate is applied by the worker from
  // CACHED tables. Applied only there, a gated fixture was silently dropped
  // with no ledger write, stayed PENDING, and — sorted by soonest kickoff — was
  // re-selected every run, blocking every fixture behind it until it left the
  // window (head-of-line blocking). Apply the same gate here, before choosing,
  // and park what it cannot evaluate with a visible, uncounted deferral.
  const asCandidates = eligible.flatMap(a => {
    const [homeTeamApiId, awayTeamApiId] = a.matchKey.split("-").map(Number);
    return a.leagueApiId != null && Number.isFinite(homeTeamApiId) && Number.isFinite(awayTeamApiId)
      ? [{ ...a, leagueApiId: a.leagueApiId, homeTeamApiId, awayTeamApiId }] : [];
  });
  const passing = new Set((await filterSelectiveQueuedCandidates(asCandidates, now, true)).map(c => c.matchKey));
  const gated = eligible.filter(a => !passing.has(a.matchKey));
  if (gated.length) {
    await prisma.generationAttempt.updateMany({
      where: { matchKey: { in: gated.map(a => a.matchKey) }, status: { in: ["PENDING", "FAILED"] } },
      data: {
        status: "FAILED",
        lastError: "Early deferred, retry not counted: selective-league standings not available in cache to confirm a top-of-table side",
        nextAttemptAt: new Date(now.getTime() + EARLY_SELECTIVE_DEFER_MS),
      },
    });
  }
  const workable = eligible.filter(a => passing.has(a.matchKey));
  const quotes = workable.length ? await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: workable.map(a => a.matchKey) } },
    select: { matchKey: true, oddsJson: true, fetchedAt: true },
  }) : [];
  const byKey = new Map(quotes.map(q => [q.matchKey, q]));
  // Quote-first, NOT quote-only: unpriced fixtures must still be analysed,
  // held if weak, or sent to normal editorial review if credible. Only the
  // later atomic publication step requires an exact, fresh bookmaker quote.
  const pricedKeys = new Set<string>();
  const queueByBand: Record<string, { eligible: number; priced: number }> = {
    "48-72h": { eligible: 0, priced: 0 }, "3-7d": { eligible: 0, priced: 0 }, "7-14d": { eligible: 0, priced: 0 },
  };
  for (const a of workable) {
    const quote = byKey.get(a.matchKey);
    const hasPrice = earlyFixturePricedForGeneration({
      odds: (quote?.oddsJson as FixtureOdds | null) ?? null,
      fetchedAt: quote?.fetchedAt ?? null, kickoff: a.kickoff, now,
    });
    const band = queueByBand[earlyLeadBand(a.kickoff, now)];
    band.eligible++;
    if (hasPrice) { pricedKeys.add(a.matchKey); band.priced++; }
  }
  const chosen = orderEarlyQueue(workable, pricedKeys, now).slice(0, limit);
  const keys = chosen.map(a => a.matchKey);
  const pricedSelected = chosen.filter(a => pricedKeys.has(a.matchKey)).length;
  if (!keys.length) return { ok: true, skipped: "no available early fixtures",
    selected: 0, generated: 0, pricedSelected: 0, unpricedSelected: 0, queueByBand, deferredSelective: gated.length,
    summary: "Early generation found no pending captured fixtures" + (gated.length ? " (" + gated.length + " selective-league fixtures deferred)" : "") };
  const worker = await withNoFootballApiCalls(() => runGeneration({
    authorId: input.actorId, categories: ["FEATURED"], matchKeys: keys,
    intent: EARLY_FREE_GENERATION_INTENT,
    limit: keys.length, now,
    // Never pass adaptiveCombo: early tips are standalone selections.
  }));
  return { ok: worker.ok, selected: keys.length, generated: worker.predictionsCreated,
    pricedSelected, unpricedSelected: keys.length - pricedSelected, queueByBand, deferredSelective: gated.length,
    summary: "Early free generation selected " + keys.length + " (" + pricedSelected +
      " priced, " + (keys.length - pricedSelected) + " awaiting quotes), created " + worker.predictionsCreated,
    worker };
}
