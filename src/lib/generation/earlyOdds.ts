/**
 * Bounded early bookmaker warming for already captured/queued FREE fixtures.
 * Separate from the ordinary 72h and paid odds workloads: it does not expand
 * paid qualification, and cannot consume the reserved provider quota.
 */
import { prisma } from "@/lib/prisma";
import { getUsageSnapshot } from "@/lib/football/usage";
import { refreshOddsCache } from "@/lib/enrichment";
import { matchKey } from "@/lib/slug";
import { earlyFixtureMode, inEarlyGenerationWindow } from "@/lib/generation/earlyFixturePolicy";
import { earlyFixturePricedForGeneration, earlyOddsRefreshDue } from "@/lib/generation/earlyOddsPolicy";
import type { FixtureOdds } from "@/lib/odds";

const HOUR = 3_600_000;
const MIN_QUOTA_REMAINING = 1_800;
export const EARLY_ODDS_MAX_PER_RUN = 16;

export type EarlyOddsWarmReport = {
  ok: boolean; mode: string; considered: number; due: number; attempted: number;
  quoted: number; unquoted: number; failures: string[]; summary: string;
  coverageByLeadDays: Record<string, { fixtures: number; quoted: number; publishable: number }>;
};

export async function runEarlyOddsWarming(input: { now?: Date; limit?: number } = {}): Promise<EarlyOddsWarmReport> {
  const now = input.now ?? new Date();
  const mode = earlyFixtureMode();
  const report: EarlyOddsWarmReport = {
    ok: true, mode, considered: 0, due: 0, attempted: 0,
    quoted: 0, unquoted: 0, failures: [], summary: "",
    coverageByLeadDays: Object.fromEntries(["2-3", "4-5", "6-7", "8-10", "11-14"].map(k =>
      [k, { fixtures: 0, quoted: 0, publishable: 0 }])),
  };
  const finish = () => {
    report.ok = report.failures.length === 0;
    report.summary = "Early bookmaker quotes " + mode + ": " + report.considered +
      " captured fixtures, " + report.due + " due, " + report.attempted +
      " fetched, " + report.quoted + " priced, " + report.unquoted + " unavailable, " +
      report.failures.length + " errors";
    return report;
  };
  if (mode !== "on") return finish();
  const usage = await getUsageSnapshot();
  if (usage.remaining < MIN_QUOTA_REMAINING) return finish();

  const limit = Math.min(EARLY_ODDS_MAX_PER_RUN, Math.max(1, Math.trunc(input.limit ?? 4)));
  const fixtures = await prisma.upcomingFixture.findMany({
    where: {
      earlyQueuedAt: { not: null }, status: "NS",
      kickoff: { gt: new Date(now.getTime() + 48 * HOUR), lte: new Date(now.getTime() + 14 * 24 * HOUR) },
    },
    select: {
      fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true,
      leagueApiId: true, kickoff: true,
    },
    orderBy: [{ kickoff: "asc" }, { fixtureApiId: "asc" }],
  });
  const captured = fixtures
    .filter(f => inEarlyGenerationWindow(f.kickoff, now, f.leagueApiId))
    .map(f => ({ ...f, matchKey: matchKey(f) }))
    .filter((f): f is typeof f & { matchKey: string } => f.matchKey !== null);
  report.considered = captured.length;
  if (captured.length === 0) return finish();

  const cached = await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: captured.map(f => f.matchKey) } },
    select: { matchKey: true, fetchedAt: true, lastAttemptAt: true, oddsJson: true },
  });
  const byKey = new Map(cached.map(c => [c.matchKey, c]));
  // Read-only lead-time coverage counters for tomorrow's 3/5/7/10/14-day
  // verification, based on actually quoted early candidates, not assumptions
  // about provider-supported horizons. No extra external requests.
  for (const fixture of captured) {
    const days = (fixture.kickoff.getTime() - now.getTime()) / (24 * HOUR);
    const band = days <= 3 ? "2-3" : days <= 5 ? "4-5" :
      days <= 7 ? "6-7" : days <= 10 ? "8-10" : "11-14";
    const stats = report.coverageByLeadDays[band];
    const cache = byKey.get(fixture.matchKey);
    stats.fixtures++;
    if (cache?.fetchedAt && cache.oddsJson) stats.quoted++;
    if (earlyFixturePricedForGeneration({
      odds: (cache?.oddsJson as FixtureOdds | null) ?? null,
      fetchedAt: cache?.fetchedAt ?? null, kickoff: fixture.kickoff, now,
    })) stats.publishable++;
  }
  // No first-400-row ceiling: every active queued fixture is considered.
  // Failed/unpriced quotes retry on a lead-time-aware backoff, so provider
  // quota is spent on new opportunities, not repeatedly on one empty market.
  const due = captured.filter(f => {
    const row = byKey.get(f.matchKey);
    return earlyOddsRefreshDue({
      kickoff: f.kickoff, now,
      fetchedAt: row?.fetchedAt ?? null, lastAttemptAt: row?.lastAttemptAt ?? null,
    });
  }).sort((a, b) => {
    const ca = byKey.get(a.matchKey), cb = byKey.get(b.matchKey);
    // First price absent fixtures ahead of refreshing already-priced ones.
    return Number(!!ca?.fetchedAt) - Number(!!cb?.fetchedAt) ||
      (ca?.lastAttemptAt?.getTime() ?? 0) - (cb?.lastAttemptAt?.getTime() ?? 0) ||
      a.kickoff.getTime() - b.kickoff.getTime();
  });
  report.due = due.length;
  for (const target of due.slice(0, limit)) {
    // A bounded call count and a fixed quota reserve, even for a crowded slate.
    report.attempted++;
    try {
      const result = await refreshOddsCache({
        matchKey: target.matchKey, fixtureApiId: target.fixtureApiId,
        kickoff: target.kickoff, kind: "candidate",
      });
      if (result.result === "ok") report.quoted++;
      else if (result.result === "failed") report.unquoted++;
      else report.failures.push(target.matchKey + ": " + (result.detail ?? "provider error"));
    } catch (error) {
      report.failures.push(target.matchKey + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }
  return finish();
}
