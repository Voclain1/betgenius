/**
 * The scheduled generation run.
 *
 * Deliberately not a job-queue worker. At the target of 50-100 predictions a
 * day — roughly four fixtures an hour — throughput is a non-issue, and the
 * machinery a real queue brings (brokers, visibility timeouts, competing
 * consumers) would be infrastructure with no matching constraint. What this
 * actually needs is narrower and is what the code below provides:
 *
 *   - single-flight, so two overlapping cron pokes cannot double-generate;
 *   - a per-fixture ledger, so failures back off and eventually dead-letter;
 *   - a soft deadline, so a run ends cleanly inside the platform's function
 *     limit and the next one resumes rather than dying mid-fixture.
 *
 * Nothing here publishes. Every prediction produced lands PENDING_REVIEW for a
 * human reviewer, exactly as manual generation does, at any confidence and in
 * any category.
 */

import { prisma } from "@/lib/prisma";
import { generateAndPersistPrediction } from "@/lib/ai/generate";
import { getUsageSnapshot } from "@/lib/football/usage";
import {
  selectCandidates,
  nextAttemptAt,
  MAX_GENERATION_ATTEMPTS,
  type Candidate,
} from "@/lib/generation/selector";

/**
 * Postgres advisory lock key for the generation run.
 *
 * An arbitrary constant — advisory locks are a shared namespace keyed by
 * number, so this only has to be unique within this database. Session-scoped
 * (pg_try_advisory_lock, not the _xact variant) because the work spans many
 * transactions; released explicitly in a finally block.
 */
const LOCK_KEY = 918_273_641;

/**
 * Stop claiming new fixtures past this much elapsed time.
 *
 * Vercel's limit on this plan is 300s. Stopping at 240 leaves room for the
 * fixture in flight to finish and for the ledger writes to land, so a run ends
 * by choice rather than by being killed — the difference between "resumable"
 * and "lost the last fixture's state".
 */
const SOFT_DEADLINE_MS = 240_000;

/** Below this remaining daily api-football budget the run stops early rather than starting work it can't finish. */
const MIN_QUOTA_HEADROOM = 200;

export type RunReport = {
  ok: boolean;
  reason?: string;
  claimed: number;
  succeeded: number;
  failed: number;
  abandoned: number;
  predictionsCreated: number;
  /** How the digest was assembled across the run — the cache-effectiveness signal. */
  cacheHits: number;
  fetches: number;
  apiCallsSpent: number;
  discoveryCalls: number;
  quotaRemaining: number;
  elapsedMs: number;
  results: Array<{ fixture: string; kickoff: string; ok: boolean; predictions?: number; error?: string; terminal?: boolean }>;
};

/** Single-flight guard. Returns false when another run already holds the lock. */
async function acquireLock(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`;
  return rows[0]?.locked === true;
}

async function releaseLock(): Promise<void> {
  await prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
}

/**
 * Record the outcome of one fixture in the ledger.
 *
 * Uses upsert on the unique matchKey, which is also what makes the whole run
 * idempotent: a fixture can only ever have one ledger row, so a repeated or
 * concurrent run converges rather than duplicating.
 */
async function recordAttempt(
  c: Candidate,
  outcome: { ok: true; predictionIds: string[] } | { ok: false; error: string },
): Promise<{ terminal: boolean }> {
  const attempts = c.priorAttempts + 1;
  const now = new Date();

  if (outcome.ok) {
    const data = {
      fixtureApiId: c.fixtureApiId,
      leagueApiId: c.leagueApiId,
      homeTeam: c.homeTeam,
      awayTeam: c.awayTeam,
      kickoff: c.kickoff,
      status: "SUCCEEDED",
      attempts,
      lastError: null,
      lastAttemptAt: now,
      nextAttemptAt: null,
      predictionIds: outcome.predictionIds,
    };
    await prisma.generationAttempt.upsert({ where: { matchKey: c.matchKey }, create: { matchKey: c.matchKey, ...data }, update: data });
    return { terminal: true };
  }

  const retryAt = attempts >= MAX_GENERATION_ATTEMPTS ? null : nextAttemptAt(attempts, now);
  // Retries spent — dead-letter it. The row stays visible in the admin panel so
  // a permanently broken fixture is something you can see, not something that
  // silently stopped happening.
  const status = retryAt === null ? "ABANDONED" : "FAILED";
  const data = {
    fixtureApiId: c.fixtureApiId,
    leagueApiId: c.leagueApiId,
    homeTeam: c.homeTeam,
    awayTeam: c.awayTeam,
    kickoff: c.kickoff,
    status,
    attempts,
    lastError: outcome.error.slice(0, 500),
    lastAttemptAt: now,
    nextAttemptAt: retryAt,
  };
  await prisma.generationAttempt.upsert({ where: { matchKey: c.matchKey }, create: { matchKey: c.matchKey, ...data }, update: data });
  return { terminal: status === "ABANDONED" };
}

export async function runGeneration(opts: {
  authorId: string;
  categories: string[];
  leagueApiIds?: number[];
  limit: number;
  now?: Date;
}): Promise<RunReport> {
  const startedAt = Date.now();
  const empty = (reason: string, quotaRemaining = 0): RunReport => ({
    ok: false, reason, claimed: 0, succeeded: 0, failed: 0, abandoned: 0, predictionsCreated: 0,
    cacheHits: 0, fetches: 0, apiCallsSpent: 0, discoveryCalls: 0, quotaRemaining,
    elapsedMs: Date.now() - startedAt, results: [],
  });

  if (!(await acquireLock())) return empty("another generation run is already in progress");

  try {
    const usage = await getUsageSnapshot();
    if (usage.remaining < MIN_QUOTA_HEADROOM) {
      return empty(`api-football daily budget nearly exhausted (${usage.remaining} left)`, usage.remaining);
    }

    const { candidates, discoveryCalls } = await selectCandidates({
      leagueApiIds: opts.leagueApiIds,
      now: opts.now,
      limit: opts.limit,
    });

    const report: RunReport = {
      ok: true, claimed: candidates.length, succeeded: 0, failed: 0, abandoned: 0, predictionsCreated: 0,
      cacheHits: 0, fetches: 0, apiCallsSpent: 0, discoveryCalls,
      quotaRemaining: usage.remaining, elapsedMs: 0, results: [],
    };

    for (const c of candidates) {
      // Stop claiming new work rather than risk being killed mid-fixture. The
      // remaining candidates are simply re-derived next run.
      if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
        report.reason = "soft deadline reached — remaining fixtures deferred to the next run";
        break;
      }

      const label = `${c.homeTeam} vs ${c.awayTeam}`;
      try {
        const { predictions, sources } = await generateAndPersistPrediction({
          home: c.homeTeam,
          away: c.awayTeam,
          league: c.leagueName,
          leagueApiId: c.leagueApiId,
          kickoff: c.kickoff.toISOString(),
          categories: opts.categories,
          authorId: opts.authorId,
          // The fixture list already carried these — passing them through is
          // what removes the two searchTeam calls per fixture.
          homeTeamApiId: c.homeTeamApiId,
          awayTeamApiId: c.awayTeamApiId,
        });

        for (const s of [sources.homeTeam, sources.awayTeam, sources.standings, sources.h2h]) {
          if (s === "cache") report.cacheHits++;
          else if (s === "fetched") report.fetches++;
        }
        report.apiCallsSpent += sources.apiCalls;
        report.succeeded++;
        report.predictionsCreated += predictions.length;

        await recordAttempt(c, { ok: true, predictionIds: predictions.map((p) => p.id) });
        report.results.push({ fixture: label, kickoff: c.kickoff.toISOString(), ok: true, predictions: predictions.length });
      } catch (err: any) {
        const message = err?.message ?? String(err);
        const { terminal } = await recordAttempt(c, { ok: false, error: message });
        if (terminal) report.abandoned++;
        else report.failed++;
        report.results.push({ fixture: label, kickoff: c.kickoff.toISOString(), ok: false, error: message, terminal });
      }
    }

    report.quotaRemaining = (await getUsageSnapshot()).remaining;
    report.elapsedMs = Date.now() - startedAt;
    return report;
  } finally {
    await releaseLock();
  }
}
