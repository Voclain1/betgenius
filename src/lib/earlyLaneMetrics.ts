/**
 * Admin-only measurement for the five-day generation horizon and preview pages
 * (issue #237). Read-only, bounded (30-day window, fixed number of queries),
 * never public. Every figure is a count over stored rows; nothing is inferred.
 */
import { prisma } from "@/lib/prisma";
import { EARLY_FIXTURE_POLICY } from "@/lib/generation/earlyFixturePolicy";
import { matchPreviewMode } from "@/lib/matchIndexability";
import { listIndexablePreviews } from "@/lib/matchPreview";

export const LEAD_BUCKETS = ["<2d", "2-3d", "3-5d", "5-7d", "7-10d", ">10d"] as const;
export type LeadBucket = (typeof LEAD_BUCKETS)[number];

export function leadBucket(hours: number): LeadBucket {
  const d = hours / 24;
  return d < 2 ? "<2d" : d < 3 ? "2-3d" : d < 5 ? "3-5d" : d < 7 ? "5-7d" : d <= 10 ? "7-10d" : ">10d";
}

export function leadHistogram(pairs: ReadonlyArray<{ at: Date; kickoff: Date }>): Record<LeadBucket, number> {
  const out = Object.fromEntries(LEAD_BUCKETS.map((b) => [b, 0])) as Record<LeadBucket, number>;
  for (const { at, kickoff } of pairs) {
    const hours = (kickoff.getTime() - at.getTime()) / 3_600_000;
    if (Number.isFinite(hours) && hours > 0) out[leadBucket(hours)]++;
  }
  return out;
}

const WINDOW_DAYS = 30;
const MAX_ROWS = 20_000;

export async function getEarlyLaneMetrics(now: Date = new Date()) {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const [predictions, fixtures, attempts, previews] = await Promise.all([
    prisma.prediction.findMany({
      where: { createdAt: { gte: since }, kickoff: { not: null } },
      select: { createdAt: true, publishedAt: true, kickoff: true, status: true, contextComplete: true },
      take: MAX_ROWS,
    }),
    prisma.upcomingFixture.findMany({
      where: { discoveredAt: { gte: since }, kickoff: { gt: since } },
      select: { discoveredAt: true, kickoff: true },
      take: MAX_ROWS,
    }),
    prisma.generationAttempt.findMany({
      where: { createdAt: { gte: since }, status: { in: ["FAILED", "ABANDONED"] } },
      select: { lastError: true }, take: MAX_ROWS,
    }),
    listIndexablePreviews({ now }),
  ]);
  const withKick = predictions.filter((p): p is typeof p & { kickoff: Date } => p.kickoff != null);
  const status: Record<string, number> = {};
  for (const p of predictions) status[p.status] = (status[p.status] ?? 0) + 1;
  const reasons: Record<string, number> = {};
  for (const a of attempts) {
    const key = (a.lastError ?? "no reason recorded").replace(/\d+/g, "#").slice(0, 90);
    reasons[key] = (reasons[key] ?? 0) + 1;
  }
  const published = withKick.filter((p) => p.publishedAt);
  return {
    generatedAt: now.toISOString(), windowDays: WINDOW_DAYS,
    policy: { generationHours: EARLY_FIXTURE_POLICY.EARLY_GENERATION_UNTIL_HOURS, deepFallbackHours: EARLY_FIXTURE_POLICY.DEEP_FALLBACK_GENERATION_UNTIL_HOURS, previewMode: matchPreviewMode() },
    discoveryLead: leadHistogram(fixtures.map((f) => ({ at: f.discoveredAt, kickoff: f.kickoff }))),
    generationLead: leadHistogram(withKick.map((p) => ({ at: p.createdAt, kickoff: p.kickoff }))),
    publicationLead: leadHistogram(published.map((p) => ({ at: p.publishedAt!, kickoff: p.kickoff }))),
    statusCounts: status,
    withoutLiveContext: predictions.filter((p) => !p.contextComplete).length,
    failedOrAbandonedAttempts: { total: attempts.length, byReason: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 10) },
    previews: { indexableNow: previews.length, inSitemap: previews.length, note: "indexableNow equals sitemap membership: both come from listIndexablePreviews" },
    truncated: predictions.length >= MAX_ROWS || fixtures.length >= MAX_ROWS,
  };
}
