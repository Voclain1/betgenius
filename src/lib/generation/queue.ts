import { prisma } from "@/lib/prisma";
import { lagosDateKey } from "@/lib/lagosDate";
import { LEAGUE_CATALOGUE, leaguePriorityRank, normalizeLeagueName } from "@/lib/leagues";
import { selectCandidates, type Candidate } from "@/lib/generation/selector";

const DISCOVERY_BUDGET_MS = 20_000;
const DISCOVERY_START_RESERVE_MS = 4_000;

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
};

export function resolveQueuedLeagueName(leagueApiId: number, discoveredName?: string | null): string | null {
  const catalogueName = LEAGUE_CATALOGUE.find((league) => league.id === leagueApiId)?.name;
  return normalizeLeagueName(catalogueName) ?? normalizeLeagueName(discoveredName);
}

/**
 * Discover one deterministic slice of the catalogue and cache its candidates
 * as fresh PENDING GenerationAttempt rows. Existing rows are deliberately not
 * updated: retry/backoff and terminal states remain owned by the processor.
 *
 * The cursor reuses the existing coordination table and atomically reserves a
 * small consecutive batch. Concurrent requests cannot scan the same batch.
 * Repeated cycles are harmless because duplicate candidate inserts are skipped.
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
  const catalogueSize = LEAGUE_CATALOGUE.length;
  const cursorRows = await prisma.$queryRaw<Array<{ holder: string }>>`
    INSERT INTO "AppLock" ("key", "holder", "acquiredAt", "expiresAt")
    VALUES ('generation-discovery-cursor', ${String(batchSize)}, ${now}, ${new Date("2999-01-01T00:00:00Z")})
    ON CONFLICT ("key") DO UPDATE
      SET "holder" = ((("AppLock"."holder")::integer + ${batchSize}) % ${catalogueSize})::text,
          "acquiredAt" = ${now}
    RETURNING "holder"
  `;
  const cursorEnd = Number(cursorRows[0]?.holder ?? batchSize);
  const cursorStart = (cursorEnd - batchSize + catalogueSize) % catalogueSize;
  const leagues = Array.from({ length: batchSize }, (_, offset) => LEAGUE_CATALOGUE[(cursorStart + offset) % catalogueSize]);
  let leaguesScanned = 0;
  let discoveryCalls = 0;
  let candidatesFound = 0;
  let candidatesQueued = 0;

  for (const league of leagues) {
    if (Date.now() - startedAt >= budgetMs - DISCOVERY_START_RESERVE_MS) break;
    const result = await selectCandidates({ leagueApiIds: [league.id], now, limit: 100 });
    leaguesScanned++;
    discoveryCalls += result.discoveryCalls;
    candidatesFound += result.candidates.length;

    if (result.candidates.length) {
      const inserted = await prisma.generationAttempt.createMany({
        data: result.candidates.map((candidate) => ({
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
      candidatesQueued += inserted.count;
    }
  }

  return {
    ok: true,
    cursorStart,
    cursorEnd,
    leaguesPlanned: leagues.length,
    leaguesScanned,
    discoveryCalls,
    candidatesFound,
    candidatesQueued,
    elapsedMs: Date.now() - startedAt,
    reason: leaguesScanned < leagues.length ? "processing budget reached; remaining leagues deferred" : undefined,
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
 */
export async function selectQueuedCandidates(opts: { limit: number; now?: Date; leagueApiIds?: number[]; matchKeys?: string[] }): Promise<Candidate[]> {
  const now = opts.now ?? new Date();
  // An empty (not absent) matchKeys array means "nothing was selected", which
  // must return nothing rather than falling through to the whole ledger.
  if (opts.matchKeys && opts.matchKeys.length === 0) return [];
  const attempts = await prisma.generationAttempt.findMany({
    where: {
      kickoff: { gt: now },
      matchKey: opts.matchKeys?.length ? { in: opts.matchKeys } : undefined,
      leagueApiId: opts.leagueApiIds?.length ? { in: opts.leagueApiIds } : undefined,
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
