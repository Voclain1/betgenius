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

import { randomUUID } from "crypto";
import { startCutoffMsForCategories } from "@/lib/doublesTargeting";

import { prisma } from "@/lib/prisma";
import { generateAndPersistPrediction } from "@/lib/ai/generate";
import { findKickoffMismatches, formatKickoffMismatches, type KickoffMismatch } from "@/lib/generation/kickoffAssert";
import { getUsageSnapshot } from "@/lib/football/usage";
import {
  nextAttemptAt,
  MAX_GENERATION_ATTEMPTS,
  type Candidate,
} from "@/lib/generation/selector";
import { selectQueuedCandidates } from "@/lib/generation/queue";

/**
 * Lease key for the generation run. A row id in AppLock, not a lock manager.
 *
 * This used to be a Postgres advisory lock, which does not survive contact with
 * a connection pooler. Every connection here goes through Neon's pgbouncer in
 * transaction pooling mode, and that breaks session-scoped advisory locks in
 * both directions at once — measured against production, not theorised:
 *
 *   - the lock lands on a pgbouncer backend, and the later unlock is routed to
 *     whichever backend is free, which is usually a different one. The unlock
 *     silently no-ops and the lock is stranded on an idle backend until the
 *     compute recycles. Every later run then fails to acquire and reports
 *     "already in progress" for hours.
 *   - worse, two independent clients get multiplexed onto the SAME backend, and
 *     pg_try_advisory_lock is re-entrant per session, so BOTH return true. The
 *     guard fails open exactly when it is supposed to bite.
 *
 * pg_try_advisory_xact_lock does not rescue this. It releases at the end of its
 * transaction, and each query here is its own implicit transaction, so the lock
 * is gone before the next statement runs — no exclusion at all beyond a single
 * SELECT. Holding one run's worth of work inside a single transaction is not an
 * option either: a run lasts minutes and spends most of it awaiting a model.
 *
 * A lease is plain rows. It does not care which backend a statement lands on,
 * and it expires by wall clock, so a run killed mid-flight heals itself.
 */
const LOCK_KEY = "generation-run";

/**
 * How long a claimed lease stays valid.
 *
 * Must exceed the platform's hard function timeout (300s), or a still-running
 * run could have its lease stolen and a second run would start alongside it.
 * Must also be short enough that a killed run's lease clears on its own well
 * inside the 3-hourly schedule. Six minutes satisfies both.
 */
const LEASE_TTL_MS = 6 * 60_000;

/**
 * Stop claiming new fixtures past this much elapsed time.
 *
 * Vercel's limit on this plan is 300s. Stopping at 240 leaves room for the
 * fixture in flight to finish and for the ledger writes to land, so a run ends
 * by choice rather than by being killed — the difference between "resumable"
 * and "lost the last fixture's state".
 */
const SOFT_DEADLINE_MS = 22_000;

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
  /**
   * Rows written with a kickoff that disagrees with the candidate they came
   * from. Expected to be empty on every run — a non-empty array means the
   * historical 60-120min divergence has recurred, and the run log carries the
   * per-row detail. See src/lib/generation/kickoffAssert.ts.
   */
  kickoffMismatches: KickoffMismatch[];
};

/**
 * Single-flight guard. Returns a holder token, or null when a live run holds
 * the lease.
 *
 * One statement, so it is atomic without a transaction: the INSERT wins if no
 * row exists, and the ON CONFLICT ... WHERE only fires when the existing lease
 * has already expired. Two racing runs therefore cannot both get a row back —
 * the loser's conflict clause finds an unexpired lease and updates nothing.
 */
async function acquireLock(now: Date): Promise<string | null> {
  const holder = randomUUID();
  const expiresAt = new Date(now.getTime() + LEASE_TTL_MS);
  const rows = await prisma.$queryRaw<Array<{ holder: string }>>`
    INSERT INTO "AppLock" ("key", "holder", "acquiredAt", "expiresAt")
    VALUES (${LOCK_KEY}, ${holder}, ${now}, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE
      SET "holder" = EXCLUDED."holder",
          "acquiredAt" = EXCLUDED."acquiredAt",
          "expiresAt" = EXCLUDED."expiresAt"
      WHERE "AppLock"."expiresAt" <= ${now}
    RETURNING "holder"
  `;
  return rows[0]?.holder === holder ? holder : null;
}

/**
 * Release our own lease and nobody else's.
 *
 * The holder check matters in the one case the TTL is meant to cover: if this
 * run overran its lease and another run legitimately took over, this delete
 * must not remove the new holder's claim on the way out.
 */
async function releaseLock(holder: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "AppLock" WHERE "key" = ${LOCK_KEY} AND "holder" = ${holder}`.catch(() => {});
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
  /** Recorded on AIJob.prompt so daily quotas can count attempts by intent. */
  intent?: string;
  leagueApiIds?: number[];
  /** Explicit fixture allow-list — used by price-first Bet of the Day targeting. */
  matchKeys?: string[];
  limit: number;
  now?: Date;
}): Promise<RunReport> {
  const startedAt = Date.now();
  const empty = (reason: string, quotaRemaining = 0): RunReport => ({
    ok: false, reason, claimed: 0, succeeded: 0, failed: 0, abandoned: 0, predictionsCreated: 0,
    cacheHits: 0, fetches: 0, apiCallsSpent: 0, discoveryCalls: 0, quotaRemaining,
    elapsedMs: Date.now() - startedAt, results: [], kickoffMismatches: [],
  });

  const holder = await acquireLock(opts.now ?? new Date());
  if (!holder) return empty("another generation run is already in progress");

  try {
    const usage = await getUsageSnapshot();
    if (usage.remaining < MIN_QUOTA_HEADROOM) {
      return empty(`api-football daily budget nearly exhausted (${usage.remaining} left)`, usage.remaining);
    }

    const candidates = await selectQueuedCandidates({ now: opts.now, limit: opts.limit, leagueApiIds: opts.leagueApiIds, matchKeys: opts.matchKeys });

    const report: RunReport = {
      ok: true, claimed: candidates.length, succeeded: 0, failed: 0, abandoned: 0, predictionsCreated: 0,
      cacheHits: 0, fetches: 0, apiCallsSpent: 0, discoveryCalls: 0,
      quotaRemaining: usage.remaining, elapsedMs: 0, results: [], kickoffMismatches: [],
    };

    // Doubles cost about twice a normal fixture, so they get a tighter cutoff
    // derived from cron-job.org's 30s ceiling rather than the general one.
    const startCutoffMs = startCutoffMsForCategories(opts.categories, SOFT_DEADLINE_MS, opts.intent);

    for (const c of candidates) {
      // Stop claiming new work rather than risk being killed mid-fixture. The
      // remaining candidates are simply re-derived next run.
      if (Date.now() - startedAt >= startCutoffMs) {
        report.reason = "soft deadline reached — remaining fixtures deferred to the next run";
        break;
      }

      const label = `${c.homeTeam} vs ${c.awayTeam}`;
      try {
        const { predictions, combo, sources } = await generateAndPersistPrediction({
          home: c.homeTeam,
          away: c.awayTeam,
          league: c.leagueName,
          leagueApiId: c.leagueApiId,
          kickoff: c.kickoff.toISOString(),
          round: c.round,
          categories: opts.categories,
          intent: opts.intent,
          authorId: opts.authorId,
          // The fixture list already carried these — passing them through is
          // what removes the two searchTeam calls per fixture.
          homeTeamApiId: c.homeTeamApiId,
          awayTeamApiId: c.awayTeamApiId,
          // Same discovery row that fills GenerationAttempt.fixtureApiId. This
          // is what lets settlement resolve by id and stops a rescheduled
          // fixture from being re-generated under a new matchKey.
          fixtureApiId: c.fixtureApiId,
        });

        for (const s of [sources.homeTeam, sources.awayTeam, sources.standings, sources.h2h]) {
          if (s === "cache") report.cacheHits++;
          else if (s === "fetched") report.fetches++;
        }
        report.apiCallsSpent += sources.apiCalls;
        report.succeeded++;
        report.predictionsCreated += predictions.length + (combo ? 1 : 0);

        const predictionIds = [...predictions.map((p) => p.id), ...(combo ? [combo.predictionId] : [])];

        // Assert the rows we just wrote actually carry the candidate's kickoff.
        // recordAttempt below stores c.kickoff, and historically those two
        // disagreed by 60-120min in the same run without anything noticing —
        // see src/lib/generation/kickoffAssert.ts. Read back rather than trust
        // the in-memory value, because the point is to verify what LANDED.
        const written = await prisma.prediction.findMany({
          where: { id: { in: predictionIds } },
          select: { id: true, kickoff: true },
        });
        const mismatches = findKickoffMismatches(c.kickoff, written);
        if (mismatches.length) {
          report.kickoffMismatches.push(...mismatches);
          // Loud, and never fatal: the prediction itself is fine, its timestamp
          // is not, and failing the run would throw away good work.
          console.error(formatKickoffMismatches(label, mismatches));
        }

        await recordAttempt(c, { ok: true, predictionIds });
        report.results.push({ fixture: label, kickoff: c.kickoff.toISOString(), ok: true, predictions: predictionIds.length });
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
    await releaseLock(holder);
  }
}
