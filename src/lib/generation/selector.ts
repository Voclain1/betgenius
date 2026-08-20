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
import { LEAGUE_CATALOGUE } from "@/lib/leagues";

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

  const from = new Date(now.getTime() + GENERATE_FROM_HOURS * 3_600_000);
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
  const inWindow = rows.filter((f) => {
    if (f.fixture.status.short !== "NS") return false;
    const k = new Date(f.fixture.date);
    return !isNaN(k.getTime()) && k >= from && k <= until;
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
  const existing = await prisma.prediction.findMany({
    where: { homeTeamApiId: { not: null }, awayTeamApiId: { not: null }, kickoff: { not: null } },
    select: { homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
  });
  const generated = new Set(existing.map((p) => matchKey(p)).filter((k): k is string => k !== null));

  const ledger = await prisma.generationAttempt.findMany({ where: { matchKey: { in: keys } } });
  const ledgerByKey = new Map(ledger.map((a) => [a.matchKey, a]));

  const candidates: Candidate[] = [];
  for (const { key, f } of keyed) {
    if (generated.has(key)) continue;

    const attempt = ledgerByKey.get(key);
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
      priorAttempts: attempt?.attempts ?? 0,
    });
  }

  // Soonest kickoff first: the fixture closest to going off is both the most
  // urgent to review and the one whose team news is most settled.
  candidates.sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());

  return { candidates: candidates.slice(0, opts.limit), scanned: keyed.length, discoveryCalls };
}
