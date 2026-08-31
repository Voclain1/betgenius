/**
 * Which fixtures the scheduled generator should produce predictions for next.
 *
 * Candidates are DERIVED from upcoming fixtures on every run rather than
 * enqueued in advance. Prediction rows are already the state — a fixture that
 * has predictions is done, one that doesn't is pending — so a pre-populated
 * queue would be a second source of truth that goes stale the moment a fixture
 * is postponed, rescheduled or abandoned. Derivation gives idempotency,
 * duplicate prevention and resumability for free.
 *
 * GenerationAttempt supplies the one thing derivation cannot: memory of
 * failure, so a fixture that fails forever stops being selected instead of
 * burning quota every run.
 */

import { prisma } from "@/lib/prisma";
import { getFixturesByLeague, resolveSeason, type FixtureRow } from "@/lib/football/api-football";
import { matchKey } from "@/lib/slug";
import { LEAGUE_CATALOGUE, leaguePriorityRank } from "@/lib/leagues";
import { lagosDateKey } from "@/lib/lagosDate";
import { fixtureIsInCupScope } from "@/lib/cupConfig";

/**
 * The generation window, in hours before kickoff.
 *
 * Upper bound: past ~48h, team news is not yet settled and anything generated
 * will be stale by the time a reviewer sees it, let alone a reader.
 *
 * Lower bound: 12h leaves a reviewer most of a day to work through the queue.
 * Since nothing auto-publishes, a prediction generated closer than this is
 * likely to reach kickoff unreviewed and be wasted effort.
 *
 * The sweet spot the ordering actually targets is ~24-36h out: firm enough
 * team news, and a full review cycle still ahead of it.
 */
export const GENERATE_FROM_HOURS = 12;
export const SAME_DAY_GENERATE_FROM_HOURS = 2;
export const GENERATE_UNTIL_HOURS = 48;

/** Backoff schedule by attempt count. Beyond the last entry the fixture is abandoned. */
export const RETRY_BACKOFF_MINUTES = [15, 60, 240];
export const MAX_GENERATION_ATTEMPTS = RETRY_BACKOFF_MINUTES.length;

export type Candidate = {
  matchKey: string;
  fixtureApiId: number;
  leagueApiId: number;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number;
  awayTeamApiId: number;
  kickoff: Date;
  round: string | null;
  /** Existing ledger row, when this fixture has been tried before. */
  priorAttempts: number;
};

/** When a failed attempt becomes eligible again, or null once retries are spent. */
export function nextAttemptAt(attempts: number, from: Date = new Date()): Date | null {
  const minutes = RETRY_BACKOFF_MINUTES[attempts - 1];
  if (minutes === undefined) return null;
  return new Date(from.getTime() + minutes * 60_000);
}

/**
 * Fixtures in the window that still need predictions.
 *
 * `leagueApiIds` defaults to the whole catalogue; the caller narrows it to
 * control both scope and the per-run fixture-discovery cost (one call per
 * league).
 */
export async function selectCandidates(opts: {
  leagueApiIds?: number[];
  now?: Date;
  /** Hard cap on returned candidates — the worker's own deadline may take fewer. */
  limit: number;
}): Promise<{ candidates: Candidate[]; scanned: number; discoveryCalls: number }> {
  const now = opts.now ?? new Date();
  const leagueIds = opts.leagueApiIds?.length ? opts.leagueApiIds : LEAGUE_CATALOGUE.map((l) => l.id);
  const leagueNameById = new Map<number, string>(LEAGUE_CATALOGUE.map((l) => [l.id, l.name]));

  const from = new Date(now.getTime() + SAME_DAY_GENERATE_FROM_HOURS * 3_600_000);
  const until = new Date(now.getTime() + GENERATE_UNTIL_HOURS * 3_600_000);
  const fromDay = from.toISOString().slice(0, 10);
  const untilDay = until.toISOString().slice(0, 10);

  // One /fixtures call per league covers the whole window, so discovery cost
  // scales with league count, not fixture count.
  let discoveryCalls = 0;
  const rows: FixtureRow[] = [];
  for (const id of leagueIds) {
    const season = await resolveSeason(id, from);
    const fixtures = await getFixturesByLeague(id, season, fromDay, untilDay);
    discoveryCalls++;
    if (fixtures) rows.push(...fixtures);
  }

  // Only unstarted fixtures with both team ids and a kickoff genuinely inside
  // the window — the day-granular API query returns whole days at the edges.
  const todayKey = lagosDateKey(now);
  const normalFrom = new Date(now.getTime() + GENERATE_FROM_HOURS * 3_600_000);
  const inWindow = rows.filter((f) => {
    if (f.fixture.status.short !== "NS") return false;
    if (!fixtureIsInCupScope(f.league.id, f.league.round)) return false;
    const k = new Date(f.fixture.date);
    if (isNaN(k.getTime()) || k < from || k > until) return false;
    return lagosDateKey(k) === todayKey || k >= normalFrom;
  });

  const keyed = inWindow
    .map((f) => {
      const key = matchKey({ homeTeamApiId: f.teams.home.id, awayTeamApiId: f.teams.away.id, kickoff: f.fixture.date });
      return key ? { key, f } : null;
    })
    .filter((x): x is { key: string; f: FixtureRow } => x !== null);

  if (keyed.length === 0) return { candidates: [], scanned: 0, discoveryCalls };

  const keys = keyed.map((k) => k.key);

  // Exclude anything already generated. Deliberately matched on ANY status,
  // including PENDING_REVIEW and ARCHIVED: a fixture awaiting review is not a
  // gap to fill, and one an admin archived should not silently come back.
  //
  // TWO identities, because matchKey alone is not stable. matchKey embeds the
  // UTC day, so when a fixture is rescheduled to another day its key changes
  // and the fixture reads as brand new — which is exactly how six fixtures
  // ended up with two complete sets of published predictions, the stale set
  // stuck PENDING forever because settlement could not find it on its old
  // date. fixtureApiId does not change when a fixture moves, so it is checked
  // first and matchKey remains only as the fallback for rows generated before
  // the id was captured.
  const existing = await prisma.prediction.findMany({
    where: {
      OR: [
        { fixtureApiId: { not: null } },
        { homeTeamApiId: { not: null }, awayTeamApiId: { not: null }, kickoff: { not: null } },
      ],
    },
    select: { fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
  });
  const generated = new Set(existing.map((p) => matchKey(p)).filter((k): k is string => k !== null));
  const generatedFixtureIds = new Set(
    existing.map((p) => p.fixtureApiId).filter((id): id is number => id != null),
  );

  const fixtureIds = keyed.map((k) => k.f.fixture.id).filter((id): id is number => id != null);
  // Ledger read by BOTH identities for the same reason: a fixture abandoned
  // under its old matchKey must stay abandoned after it is rescheduled.
  const ledger = await prisma.generationAttempt.findMany({
    where: { OR: [{ matchKey: { in: keys } }, { fixtureApiId: { in: fixtureIds } }] },
  });
  const ledgerByKey = new Map(ledger.map((a) => [a.matchKey, a]));
  const ledgerByFixtureId = new Map(
    ledger.filter((a) => a.fixtureApiId != null).map((a) => [a.fixtureApiId as number, a]),
  );

  const candidates: Candidate[] = [];
  for (const { key, f } of keyed) {
    if (generated.has(key)) continue;
    if (f.fixture.id != null && generatedFixtureIds.has(f.fixture.id)) continue;

    const attempt = ledgerByKey.get(key) ?? (f.fixture.id != null ? ledgerByFixtureId.get(f.fixture.id) : undefined);
    if (attempt) {
      // SUCCEEDED without predictions shouldn't happen, but treat both terminal
      // states as final either way — ABANDONED is the dead letter.
      if (attempt.status === "SUCCEEDED" || attempt.status === "ABANDONED") continue;
      // Still serving its backoff.
      if (attempt.nextAttemptAt && attempt.nextAttemptAt > now) continue;
    }

    candidates.push({
      matchKey: key,
      fixtureApiId: f.fixture.id,
      leagueApiId: f.league.id,
      leagueName: leagueNameById.get(f.league.id) ?? f.league.name,
      homeTeam: f.teams.home.name,
      awayTeam: f.teams.away.name,
      homeTeamApiId: f.teams.home.id,
      awayTeamApiId: f.teams.away.id,
      kickoff: new Date(f.fixture.date),
      round: f.league.round ?? null,
      priorAttempts: attempt?.attempts ?? 0,
    });
  }

  // Exhaust today's remaining eligible fixtures before tomorrow+, regardless
  // of whether an early tomorrow kickoff is chronologically closer to now.
  candidates.sort((a, b) => {
    const aToday = lagosDateKey(a.kickoff) === todayKey ? 0 : 1;
    const bToday = lagosDateKey(b.kickoff) === todayKey ? 0 : 1;
    return aToday - bToday
      || leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId)
      || a.kickoff.getTime() - b.kickoff.getTime();
  });

  return { candidates: candidates.slice(0, opts.limit), scanned: keyed.length, discoveryCalls };
}
