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
import { earlyOddsRefreshDue } from "@/lib/generation/earlyOddsPolicy";

const HOUR = 3_600_000;
const MIN_QUOTA_REMAINING = 1_800;
export const EARLY_ODDS_MAX_PER_RUN = 6;

export type EarlyOddsWarmReport = {
  ok: boolean; mode: string; considered: number; due: number; attempted: number;
  quoted: number; unquoted: number; failures: string[]; summary: string;
};

export async function runEarlyOddsWarming(input: { now?: Date; limit?: number } = {}): Promise<EarlyOddsWarmReport> {
  const now = input.now ?? new Date();
  const mode = earlyFixtureMode();
  const report: EarlyOddsWarmReport = {
    ok: true, mode, considered: 0, due: 0, attempted: 0,
    quoted: 0, unquoted: 0, failures: [], summary: "",
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
    take: 400,
  });
  const captured = fixtures
    .filter(f => inEarlyGenerationWindow(f.kickoff, now, f.leagueApiId))
    .map(f => ({ ...f, matchKey: matchKey(f) }))
    .filter((f): f is typeof f & { matchKey: string } => f.matchKey !== null);
  report.considered = captured.length;
  if (captured.length === 0) return finish();

  const cached = await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: captured.map(f => f.matchKey) } },
    select: { matchKey: true, fetchedAt: true, lastAttemptAt: true },
  });
  const byKey = new Map(cached.map(c => [c.matchKey, c]));
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
