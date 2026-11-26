/**
 * Head-to-head pre-fetch for the early lane (owner decision, 26 Nov 2026).
 *
 * WHY. The early lane analyses fixtures 2-5 days ahead from CACHED evidence
 * only, and since the five-day horizon (#237) it covers almost every fixture
 * before the regular generator sees it. Its digests carried head-to-head
 * history 13-30% of the time against 85% for regular rows, and outside the
 * top leagues that is the difference that showed: picks at Banker confidence
 * (75+) were 3.7% with H2H and 0.8% without (regular rows: 6.7% / 3.0%).
 * Banker fell from about 7 a day to 0-5 (scripts/diagnose-banker.ts).
 *
 * WHAT. Before an early run's (cache-only, provider-free) generation, each
 * selected fixture whose pair has no cached H2H gets ONE head-to-head request.
 * H2H is cached for good once fetched, and these fixtures no longer reach the
 * regular generator (which made the same request), so this moves a request
 * earlier rather than adding one. Generation itself stays provider-call free.
 *
 * BOUNDS.
 *  - At most the run's own fixtures (the early run selects 1-4).
 *  - Only while the day keeps EARLY_H2H_MIN_HEADROOM requests beyond the
 *    general reserve, so the early lane never contributes to the evening
 *    budget exhaustion the paid pass depends on (the paid reserve is separate).
 *  - A pair that failed is not retried for EARLY_H2H_RETRY_MS.
 *  - A refusal by our own budget gate is not recorded as an attempt.
 */
import { prisma } from "@/lib/prisma";
import { h2hPairKey } from "@/lib/slug";
import { getUsageSnapshot, PAID_PRIORITY_RESERVE } from "@/lib/football/usage";

export const EARLY_H2H_MIN_HEADROOM = 1000;
export const EARLY_H2H_RETRY_MS = 24 * 3_600_000;

export type EarlyH2HTarget = { homeTeamApiId: number; awayTeamApiId: number; kickoff: Date };
export type EarlyH2HReport = { considered: number; alreadyCached: number; fetched: number; failed: number; retryWait: number; skippedBudget: number };

type Deps = {
  remaining: () => Promise<number>;
  cached: (pairKey: string) => Promise<{ fetchedAt: Date | null; lastAttemptAt: Date | null } | null>;
  refresh: (t: { pairKey: string; teamAApiId: number; teamBApiId: number; latestKickoff: Date }) => Promise<{ result: "ok" | "failed" | "error" }>;
};

const defaultDeps: Deps = {
  remaining: async () => (await getUsageSnapshot()).remaining,
  cached: (pairKey) => prisma.h2HCache.findUnique({ where: { pairKey }, select: { fetchedAt: true, lastAttemptAt: true } }),
  refresh: async (t) => (await import("@/lib/enrichment")).refreshH2HCache(t),
};

/** Fetch missing H2H for the early run's fixtures, within the bounds above. */
export async function prefetchEarlyH2H(targets: readonly EarlyH2HTarget[], now: Date = new Date(), deps: Deps = defaultDeps): Promise<EarlyH2HReport> {
  const report: EarlyH2HReport = { considered: 0, alreadyCached: 0, fetched: 0, failed: 0, retryWait: 0, skippedBudget: 0 };
  const seen = new Set<string>();
  for (const t of targets) {
    const pairKey = h2hPairKey(t.homeTeamApiId, t.awayTeamApiId);
    if (!pairKey || seen.has(pairKey)) continue;
    seen.add(pairKey);
    report.considered++;
    const row = await deps.cached(pairKey);
    if (row?.fetchedAt) { report.alreadyCached++; continue; }
    if (row?.lastAttemptAt && now.getTime() - row.lastAttemptAt.getTime() < EARLY_H2H_RETRY_MS) { report.retryWait++; continue; }
    // General callers already stop PAID_PRIORITY_RESERVE early; keep a further margin on top.
    if ((await deps.remaining()) - PAID_PRIORITY_RESERVE < EARLY_H2H_MIN_HEADROOM) { report.skippedBudget++; continue; }
    const r = await deps.refresh({ pairKey, teamAApiId: Math.min(t.homeTeamApiId, t.awayTeamApiId), teamBApiId: Math.max(t.homeTeamApiId, t.awayTeamApiId), latestKickoff: t.kickoff });
    if (r.result === "ok") report.fetched++; else report.failed++;
  }
  return report;
}
