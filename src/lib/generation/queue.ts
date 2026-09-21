import { prisma } from "@/lib/prisma";
import { lagosDateKey } from "@/lib/lagosDate";
import { LEAGUE_CATALOGUE, generationTierOf, leaguePriorityRank, leaguesInTiers, normalizeLeagueName, type GenerationTier } from "@/lib/leagues";
import { candidatesFromFixtures, selectCandidates, type Candidate } from "@/lib/generation/selector";
import { getFixturesByDate, type FixtureRow } from "@/lib/football/api-football";
import { getUsageSnapshot } from "@/lib/football/usage";
import { matchKey } from "@/lib/slug";
import {
  COVERAGE_POLICY,
  coverageHorizon,
  decideCoverage,
  emptyTierCounts,
  fillFromTiers,
  planFallback,
  summariseCoverage,
  sweepDates,
  tallySlate,
  type CoverageDecision,
  type CoverageMode,
  type GateRejection,
  type OddsKnowledge,
  type TierCounts,
} from "@/lib/generation/coverage";

const DISCOVERY_BUDGET_MS = 20_000;
const DISCOVERY_START_RESERVE_MS = 4_000;
/** The fallback sweep needs up to three provider calls and a few queries; do not start it with less than this left. */
const SWEEP_START_RESERVE_MS = 8_000;

/**
 * The per-league cursor walks ONLY the base scope. FALLBACK and DEEP_FALLBACK
 * leagues are never scanned one call per league. When they are needed, the
 * by-date sweep finds all of them with one call per day.
 */
export const BASE_DISCOVERY_LEAGUE_IDS: readonly number[] = leaguesInTiers(["CORE", "SECONDARY"]);

const CURSOR_KEY = "generation-discovery-cursor";
const SWEEP_LEASE_KEY = "generation-fallback-sweep";

export type CoverageReport = {
  mode: CoverageMode;
  horizonHours: number;
  counts: TierCounts;
  higherTierCount: number;
  widened: boolean;
  target: number | null;
  fallbackAlreadySelected: number;
  need: number;
  /** Fallback fixtures newly queued by THIS run. */
  fallbackSelected: number;
  fallbackSelectedByTier: Partial<Record<GenerationTier, number>>;
  /** Cursor: leagues scanned one call each. Sweep: distinct competitions present in the by-date payload. */
  leaguesScannedByTier: { cursor: TierCounts; sweep: TierCounts };
  providerCalls: { cursor: number; sweep: number; total: number };
  sweep: {
    ran: boolean;
    dates: string[];
    skippedReason: string | null;
    fixturesInPayload: number;
    fallbackConsidered: number;
    gateRejected: Partial<Record<GateRejection, number>>;
  };
  /** Why the scope widened, or null when it did not. */
  widenedReason: string | null;
  /** Why it stayed at CORE+SECONDARY, or null when it widened. */
  narrowReason: string | null;
};

export type DiscoveryReport = {
  ok: boolean;
  cursorStart: number;
  cursorEnd: number;
  leaguesPlanned: number;
  leaguesScanned: number;
  discoveryCalls: number;
  candidatesFound: number;
  candidatesQueued: number;
  elapsedMs: number;
  reason?: string;
  coverage: CoverageReport;
  /** One line for /admin/jobs. */
  summary: string;
};

export function resolveQueuedLeagueName(leagueApiId: number, discoveredName?: string | null): string | null {
  const catalogueName = LEAGUE_CATALOGUE.find((league) => league.id === leagueApiId)?.name;
  return normalizeLeagueName(catalogueName) ?? normalizeLeagueName(discoveredName);
}

/**
 * Cache candidates as fresh PENDING GenerationAttempt rows. Existing rows are
 * deliberately not updated: retry/backoff and terminal states remain owned by
 * the processor, and duplicate inserts are skipped.
 */
async function queueCandidates(candidates: Candidate[]): Promise<number> {
  if (!candidates.length) return 0;
  const inserted = await prisma.generationAttempt.createMany({
    data: candidates.map((candidate) => ({
      matchKey: candidate.matchKey,
      fixtureApiId: candidate.fixtureApiId,
      leagueApiId: candidate.leagueApiId,
      leagueName: candidate.leagueName,
      homeTeam: candidate.homeTeam,
      awayTeam: candidate.awayTeam,
      kickoff: candidate.kickoff,
      round: candidate.round,
      status: "PENDING",
    })),
    skipDuplicates: true,
  });
  return inserted.count;
}

/**
 * How many viable fixtures each tier already has in the horizon, read from the
 * database with ZERO provider calls. This is how "thin" is detected without
 * spending quota. The per-league cursor keeps the CORE+SECONDARY ledger
 * current (a full pass over the base scope takes about 16 discovery cycles),
 * so the ledger IS the higher-tier slate. Predictions are included so a
 * fixture generated outside the scheduler still counts.
 */
export async function countViableSlate(now: Date): Promise<TierCounts> {
  const { from, until } = coverageHorizon(now);
  const [ledger, predictions] = await Promise.all([
    prisma.generationAttempt.findMany({
      where: { kickoff: { gt: from, lte: until }, status: { not: "ABANDONED" }, leagueApiId: { not: null } },
      select: { matchKey: true, fixtureApiId: true, leagueApiId: true },
    }),
    prisma.prediction.findMany({
      where: { kickoff: { gt: from, lte: until }, status: { not: "ARCHIVED" }, leagueApiId: { not: null } },
      select: { fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, leagueApiId: true },
    }),
  ]);
  return tallySlate([
    ...ledger.map((l) => ({ fixtureApiId: l.fixtureApiId, matchKey: l.matchKey, leagueApiId: l.leagueApiId })),
    ...predictions.map((p) => ({ fixtureApiId: p.fixtureApiId, matchKey: matchKey(p), leagueApiId: p.leagueApiId })),
  ]);
}

/** The current scope decision. Database only; shared by discovery and the worker so both agree. */
export async function assessCoverage(now: Date = new Date()): Promise<CoverageDecision> {
  return decideCoverage(await countViableSlate(now));
}

/**
 * Take the fallback-sweep lease. One statement, atomic across instances: the
 * row is (re)claimed only once the previous lease has expired, so however
 * often discovery is poked, the sweep's provider calls happen at most once per
 * SWEEP_INTERVAL_MINUTES. Returns the holder token, or null when held.
 */
async function acquireSweepLease(now: Date): Promise<string | null> {
  const holder = `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  const expiresAt = new Date(now.getTime() + COVERAGE_POLICY.SWEEP_INTERVAL_MINUTES * 60_000);
  const rows = await prisma.$queryRaw<Array<{ holder: string }>>`
    INSERT INTO "AppLock" ("key", "holder", "acquiredAt", "expiresAt")
    VALUES (${SWEEP_LEASE_KEY}, ${holder}, ${now}, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE
      SET "holder" = EXCLUDED."holder", "acquiredAt" = EXCLUDED."acquiredAt", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "AppLock"."expiresAt" <= ${now}
    RETURNING "holder"
  `;
  return rows[0]?.holder === holder ? holder : null;
}

/** After a sweep whose every provider call failed, retry sooner than the full interval. */
async function shortenSweepLease(holder: string, now: Date): Promise<void> {
  await prisma.appLock.updateMany({
    where: { key: SWEEP_LEASE_KEY, holder },
    data: { expiresAt: new Date(now.getTime() + COVERAGE_POLICY.SWEEP_RETRY_MINUTES * 60_000) },
  });
}

const isFallbackTier = (tier: GenerationTier | null): tier is "FALLBACK" | "DEEP_FALLBACK" => tier === "FALLBACK" || tier === "DEEP_FALLBACK";

/**
 * One discovery cycle.
 *
 *   1. CURSOR: one deterministic slice (batchSize leagues) of the BASE scope,
 *      CORE+SECONDARY only, exactly as before: one /fixtures call per league,
 *      candidates cached as PENDING ledger rows. The cursor reuses the
 *      existing coordination table and atomically reserves a consecutive
 *      batch, so concurrent requests cannot scan the same one.
 *   2. ASSESS: count the viable slate per tier from the database. No calls.
 *   3. SWEEP, only when the assessment says the slate is thin AND fallback
 *      fixtures are still needed AND the hourly lease is free AND the day's
 *      quota has headroom. Fetch the horizon's 2-3 dates with one
 *      /fixtures?date= call each, gate the fallback-tier rows, and queue just
 *      enough: FALLBACK first, DEEP_FALLBACK only if allowed and still short.
 *
 * Idempotent and resumable throughout: every insert skips duplicates, ledger
 * state is never overwritten, and an interrupted sweep is simply redone at the
 * next lease.
 */
export async function discoverGenerationCandidates(opts: {
  batchSize?: number;
  now?: Date;
  budgetMs?: number;
}): Promise<DiscoveryReport> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  const budgetMs = opts.budgetMs ?? DISCOVERY_BUDGET_MS;
  const batchSize = Math.min(Math.max(opts.batchSize ?? 3, 1), 4);
  const scope = BASE_DISCOVERY_LEAGUE_IDS;
  const scopeSize = scope.length;
  const cursorRows = await prisma.$queryRaw<Array<{ holder: string }>>`
    INSERT INTO "AppLock" ("key", "holder", "acquiredAt", "expiresAt")
    VALUES (${CURSOR_KEY}, ${String(batchSize)}, ${now}, ${new Date("2999-01-01T00:00:00Z")})
    ON CONFLICT ("key") DO UPDATE
      SET "holder" = ((("AppLock"."holder")::integer + ${batchSize}) % ${scopeSize})::text,
          "acquiredAt" = ${now}
    RETURNING "holder"
  `;
  // `% scopeSize` again because a cursor written against the old, larger
  // catalogue-wide scope may still be stored; the next cycle wraps it anyway.
  const cursorEnd = Number(cursorRows[0]?.holder ?? batchSize) % scopeSize;
  const cursorStart = (cursorEnd - batchSize + scopeSize) % scopeSize;
  const leagues = Array.from({ length: batchSize }, (_, offset) => scope[(cursorStart + offset) % scopeSize]);
  let leaguesScanned = 0;
  let cursorCalls = 0;
  let candidatesFound = 0;
  let candidatesQueued = 0;
  const cursorByTier = emptyTierCounts();

  for (const leagueApiId of leagues) {
    if (Date.now() - startedAt >= budgetMs - DISCOVERY_START_RESERVE_MS) break;
    const result = await selectCandidates({ leagueApiIds: [leagueApiId], now, limit: 100 });
    leaguesScanned++;
    const tier = generationTierOf(leagueApiId);
    if (tier) cursorByTier[tier]++;
    cursorCalls += result.discoveryCalls;
    candidatesFound += result.candidates.length;
    candidatesQueued += await queueCandidates(result.candidates);
  }

  const decision = await assessCoverage(now);
  const sweep: CoverageReport["sweep"] = { ran: false, dates: [], skippedReason: null, fixturesInPayload: 0, fallbackConsidered: 0, gateRejected: {} };
  let sweepCalls = 0;
  let sweepByTier = emptyTierCounts();
  let fallbackSelected = 0;
  let fallbackSelectedByTier: Partial<Record<GenerationTier, number>> = {};

  if (decision.widened) {
    sweep.skippedReason = await (async (): Promise<string | null> => {
      if (decision.need <= 0) return `target already met (${decision.higherTierCount} higher-tier + ${decision.fallbackAlreadySelected} fallback already selected)`;
      if (Date.now() - startedAt >= budgetMs - SWEEP_START_RESERVE_MS) return "processing budget reached; sweep deferred to the next cycle";
      const usage = await getUsageSnapshot().catch(() => null);
      if (usage && usage.remaining < COVERAGE_POLICY.SWEEP_MIN_QUOTA_REMAINING) {
        return `api-football quota headroom too low (${usage.remaining} left, sweep needs ${COVERAGE_POLICY.SWEEP_MIN_QUOTA_REMAINING})`;
      }
      return null;
    })();

    const holder = sweep.skippedReason ? null : await acquireSweepLease(now);
    if (!sweep.skippedReason && !holder) {
      sweep.skippedReason = `already swept within the last ${COVERAGE_POLICY.SWEEP_INTERVAL_MINUTES} minutes; next sweep when that lease expires`;
    }

    if (holder) {
      sweep.ran = true;
      sweep.dates = sweepDates(now);
      const rows: FixtureRow[] = [];
      let failedDates = 0;
      for (const date of sweep.dates) {
        const day = await getFixturesByDate(date);
        sweepCalls++;
        if (day) rows.push(...day);
        else failedDates++;
      }
      if (failedDates === sweep.dates.length) await shortenSweepLease(holder, now);
      sweep.fixturesInPayload = rows.length;

      const keyOf = (r: FixtureRow) => matchKey({ homeTeamApiId: r.teams?.home?.id, awayTeamApiId: r.teams?.away?.id, kickoff: r.fixture?.date });
      const fallbackKeys = rows
        .filter((r) => {
          const tier = generationTierOf(r.league?.id);
          return isFallbackTier(tier) && decision.allowedTiers.includes(tier);
        })
        .map(keyOf)
        .filter((k): k is string => !!k);
      const oddsRows = fallbackKeys.length
        ? await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: fallbackKeys } }, select: { matchKey: true, bookmakerCount: true, fetchedAt: true } })
        : [];
      const odds = new Map<string, OddsKnowledge>(oddsRows.map((o) => [o.matchKey, { bookmakerCount: o.bookmakerCount, fetchedAt: o.fetchedAt }]));

      const plan = planFallback(rows, decision, odds, keyOf);
      sweepByTier = plan.leaguesSeenByTier;
      sweep.fallbackConsidered = plan.considered;
      sweep.gateRejected = plan.rejected;

      // Same candidate rules as the cursor (window, cup scope, dedupe,
      // already-generated, ledger backoff, paid-tier reservation). Only
      // fixtures NEW to the ledger count toward `need`: ones already queued
      // were counted in fallbackAlreadySelected.
      const filled = await fillFromTiers(plan, decision, async (tierRows, need) => {
        const built = await candidatesFromFixtures(tierRows, { now, limit: tierRows.length });
        const fresh = built.candidates.filter((c) => built.newToLedger.has(c.matchKey)).slice(0, need);
        candidatesFound += fresh.length;
        const queued = await queueCandidates(fresh);
        candidatesQueued += queued;
        return queued;
      });
      fallbackSelected = filled.selected;
      fallbackSelectedByTier = filled.byTier;
    }
  }

  const coverage: CoverageReport = {
    mode: decision.mode,
    horizonHours: Math.round((coverageHorizon(now).until.getTime() - now.getTime()) / 3_600_000),
    counts: decision.counts,
    higherTierCount: decision.higherTierCount,
    widened: decision.widened,
    target: decision.target,
    fallbackAlreadySelected: decision.fallbackAlreadySelected,
    need: decision.need,
    fallbackSelected,
    fallbackSelectedByTier,
    leaguesScannedByTier: { cursor: cursorByTier, sweep: sweepByTier },
    providerCalls: { cursor: cursorCalls, sweep: sweepCalls, total: cursorCalls + sweepCalls },
    sweep,
    widenedReason: decision.widened ? decision.reason : null,
    narrowReason: decision.widened ? null : decision.reason,
  };

  return {
    ok: true,
    cursorStart,
    cursorEnd,
    leaguesPlanned: leagues.length,
    leaguesScanned,
    discoveryCalls: cursorCalls + sweepCalls,
    candidatesFound,
    candidatesQueued,
    elapsedMs: Date.now() - startedAt,
    reason: leaguesScanned < leagues.length ? "processing budget reached; remaining leagues deferred" : undefined,
    coverage,
    summary: summariseCoverage({
      mode: coverage.mode,
      higherTierCount: coverage.higherTierCount,
      widened: coverage.widened,
      target: coverage.target,
      fallbackSelected,
      providerCalls: coverage.providerCalls.total,
      sweepSkippedReason: sweep.ran ? null : sweep.skippedReason,
    }),
  };
}

/**
 * Read generation work solely from the cached ledger; no football API calls.
 *
 * `matchKeys` narrows to an explicitly chosen set. Bet of the Day generation
 * uses it to hand over fixtures already selected by market price (see
 * selectBetOfTheDayTargets), which is what lets price-first targeting reuse
 * this worker, lock and ledger rather than growing a second pipeline. Every
 * other guarantee still applies to those fixtures unchanged — the
 * already-generated exclusion, retry backoff, and terminal states.
 *
 * `excludeLeagueApiIds` is how the adaptive scope reaches the worker: ordinary
 * runs pass the tiers currently out of scope (src/lib/generation/coverage.ts),
 * so fallback rows queued on a thin day are not generated once the strong
 * leagues are back. Those rows are left untouched rather than cancelled, and
 * become selectable again if the slate thins before they kick off.
 */
export async function selectQueuedCandidates(opts: { limit: number; now?: Date; leagueApiIds?: number[]; matchKeys?: string[]; excludeLeagueApiIds?: number[] }): Promise<Candidate[]> {
  const now = opts.now ?? new Date();
  // An empty (not absent) matchKeys array means "nothing was selected", which
  // must return nothing rather than falling through to the whole ledger.
  if (opts.matchKeys && opts.matchKeys.length === 0) return [];
  const attempts = await prisma.generationAttempt.findMany({
    where: {
      kickoff: { gt: now },
      matchKey: opts.matchKeys?.length ? { in: opts.matchKeys } : undefined,
      leagueApiId: opts.leagueApiIds?.length
        ? { in: opts.leagueApiIds }
        : opts.excludeLeagueApiIds?.length
          ? { notIn: opts.excludeLeagueApiIds }
          : undefined,
      OR: [
        { status: "PENDING" },
        { status: "FAILED", nextAttemptAt: { lte: now } },
      ],
    },
  });

  const existing = await prisma.prediction.findMany({
    where: { homeTeamApiId: { not: null }, awayTeamApiId: { not: null }, kickoff: { not: null } },
    select: { homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
  });
  const generated = new Set<string>();
  for (const row of existing) {
    if (row.homeTeamApiId != null && row.awayTeamApiId != null && row.kickoff) {
      generated.add(`${row.homeTeamApiId}-${row.awayTeamApiId}-${row.kickoff.toISOString().slice(0, 10)}`);
    }
  }
  const completedAttemptIds = attempts.filter((attempt) => generated.has(attempt.matchKey)).map((attempt) => attempt.id);
  if (completedAttemptIds.length) {
    await prisma.generationAttempt.updateMany({
      where: { id: { in: completedAttemptIds } },
      data: { status: "SUCCEEDED", nextAttemptAt: null, lastError: null },
    });
  }
  const today = lagosDateKey(now);

  const unresolvedAttemptIds = attempts
    .filter((attempt) => !generated.has(attempt.matchKey))
    .filter((attempt) => attempt.leagueApiId != null)
    .filter((attempt) => !resolveQueuedLeagueName(attempt.leagueApiId!, attempt.leagueName))
    .map((attempt) => attempt.id);
  if (unresolvedAttemptIds.length) {
    await prisma.generationAttempt.updateMany({
      where: { id: { in: unresolvedAttemptIds } },
      data: {
        status: "FAILED",
        lastError: "Generation deferred: no real league name was available from the catalogue or discovery payload",
        nextAttemptAt: new Date(now.getTime() + 15 * 60_000),
      },
    });
  }

  const candidates = attempts.flatMap((attempt): Candidate[] => {
    if (generated.has(attempt.matchKey) || attempt.fixtureApiId == null || attempt.leagueApiId == null) return [];
    const leagueName = resolveQueuedLeagueName(attempt.leagueApiId, attempt.leagueName);
    if (!leagueName) return [];
    const [homeId, awayId] = attempt.matchKey.split("-").map(Number);
    if (!Number.isFinite(homeId) || !Number.isFinite(awayId)) return [];
    return [{
      matchKey: attempt.matchKey,
      fixtureApiId: attempt.fixtureApiId,
      leagueApiId: attempt.leagueApiId,
      leagueName,
      homeTeam: attempt.homeTeam,
      awayTeam: attempt.awayTeam,
      homeTeamApiId: homeId,
      awayTeamApiId: awayId,
      kickoff: attempt.kickoff,
      round: attempt.round,
      priorAttempts: attempt.attempts,
    }];
  });

  candidates.sort((a, b) => {
    const todayOrder = Number(lagosDateKey(a.kickoff) !== today) - Number(lagosDateKey(b.kickoff) !== today);
    return todayOrder
      || leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId)
      || a.kickoff.getTime() - b.kickoff.getTime()
      || a.matchKey.localeCompare(b.matchKey);
  });
  return candidates.slice(0, opts.limit);
}
