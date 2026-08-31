import { getFixturesByDate, getFixturesByIds } from "@/lib/football/api-football";

// Match-finished statuses worth settling on. Deliberately excludes in-progress
// states (1H/2H/HT/ET/BT/P/SUSP/INT) and abandoned/postponed/cancelled ones
// (ABD/PST/CANC/AWD/WO) — those need an admin, not an auto-resolver guessing.
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(fc|cf|sc|afc|cd|ud|sd)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function namesLikelyMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Extra context carried on every outcome, regardless of how the fixture was
 * located.
 *
 * `actualKickoff` is the provider's CURRENT kickoff, which is not necessarily
 * the one stored on the prediction: fixtures are generated ~42h ahead and some
 * get rescheduled inside that window. The settle route uses it to reconcile a
 * stale stored kickoff (see src/app/api/admin/settle/route.ts).
 *
 * `matchedBy` records which path found it — "id" is exact, "date" is the
 * legacy date+name heuristic kept for rows generated before fixtureApiId
 * existed.
 */
export type LookupMeta = { actualKickoff?: Date | null; matchedBy?: "id" | "date" };

export type ScoreLookupResult = (
  // `halftime` is null only when the feed omits it — see lookupFinishedScore.
  // Markets that need the halves (WIN_EITHER_HALF) resolve to null in that
  // case and are flagged for manual settlement rather than guessed.
  | { status: "scored"; homeScore: number; awayScore: number; halftime: { home: number; away: number } | null }
  | { status: "not_finished" }
  | { status: "manual_required"; reason: string }
  | { status: "not_found"; reason: string }
) & LookupMeta;

type ScorePair = { home: number | null; away: number | null };
type FinishedScoreFixture = {
  fixture: { status: { short: string } };
  goals: ScorePair;
  score?: {
    // Needed by WIN_EITHER_HALF, which derives the second half as fulltime
    // minus halftime. Present on the same response as the rest of the
    // breakdown, so reading it costs nothing.
    halftime?: ScorePair | null;
    fulltime?: ScorePair | null;
    extratime?: ScorePair | null;
    penalty?: ScorePair | null;
  };
};

function validPair(pair?: ScorePair | null): pair is { home: number; away: number } {
  return !!pair
    && Number.isInteger(pair.home) && (pair.home as number) >= 0
    && Number.isInteger(pair.away) && (pair.away as number) >= 0;
}

function emptyPair(pair?: ScorePair | null): boolean {
  return !pair || (pair.home == null && pair.away == null);
}

/**
 * Validate a finished API-Football score breakdown and return regulation time
 * only. `goals` is used solely as an integrity check because on AET fixtures it
 * includes extra-time goals. Shootout kicks are never added to any market.
 */
export function regulationScoreOf(
  match: FinishedScoreFixture,
): { ok: true; home: number; away: number; halftime: { home: number; away: number } | null } | { ok: false; reason: string } {
  const status = match.fixture.status.short;
  const fulltime = match.score?.fulltime;
  if (!validPair(fulltime) || !validPair(match.goals)) {
    return { ok: false, reason: "finished fixture is missing a complete regulation-time score breakdown" };
  }

  let expectedHome = fulltime.home;
  let expectedAway = fulltime.away;

  if (status === "AET") {
    if (!validPair(match.score?.extratime)) {
      return { ok: false, reason: "AET fixture is missing a complete extra-time score breakdown" };
    }
    expectedHome += match.score.extratime.home;
    expectedAway += match.score.extratime.away;
  } else if (status === "PEN") {
    if (!validPair(match.score?.penalty)) {
      return { ok: false, reason: "penalty-decided fixture is missing a complete shootout score breakdown" };
    }
    const extra = match.score?.extratime;
    if (!emptyPair(extra) && !validPair(extra)) {
      return { ok: false, reason: "penalty-decided fixture has a partial extra-time score breakdown" };
    }
    if (validPair(extra)) {
      expectedHome += extra.home;
      expectedAway += extra.away;
    }
  }

  if (match.goals.home !== expectedHome || match.goals.away !== expectedAway) {
    return {
      ok: false,
      reason: `finished fixture score breakdown is internally inconsistent (goals ${match.goals.home}-${match.goals.away})`,
    };
  }

  const ht = match.score?.halftime;
  return { ok: true, home: fulltime.home, away: fulltime.away, halftime: validPair(ht) ? { home: ht.home, away: ht.away } : null };
}

/**
 * Finds the finished score for one prediction's fixture via a single bounded
 * lookup — /fixtures?date=X for the kickoff date, then matched by team name —
 * rather than a full Fixture-ingestion sync (see the comment on
 * Prediction.finalHomeScore in schema.prisma for why).
 *
 * Deliberately NOT team- or league-scoped: this API-Football plan requires
 * `season` on any team-scoped /fixtures query, which for a current-season
 * match immediately hits the plan's season restriction (verified directly —
 * /fixtures?team=X&date=Y errors "Season field is required", and adding the
 * correct season then errors "Free plans do not have access to this
 * season"). The unscoped date-only query hits neither restriction.
 *
 * Goes through api-football.ts's apiFetch, so it's automatically subject to
 * the existing throttle queue.
 */
/**
 * Fetch a batch of fixtures by provider id, keyed for O(1) lookup.
 *
 * The settle route calls this ONCE per run with every candidate's
 * fixtureApiId, turning what used to be one full-day fixture list per
 * prediction into ceil(n/20) small calls for the whole batch.
 *
 * A failed call yields an empty map rather than throwing: every row simply
 * falls back to its date+name lookup, which is the pre-existing behaviour.
 */
export async function prefetchFixturesById(ids: number[]): Promise<Map<number, FinishedScoreFixture & { fixture: { id: number; date: string; status: { short: string } } }>> {
  const map = new Map<number, any>();
  if (!ids.length) return map;
  const rows = await getFixturesByIds(ids);
  for (const r of rows ?? []) map.set((r as any).fixture.id, r);
  return map;
}

/** Classify a located fixture. Shared by the id and date paths. */
function classify(
  match: any,
  matchedBy: "id" | "date",
  ours?: { homeTeamApiId?: number | null; awayTeamApiId?: number | null },
): ScoreLookupResult {
  const actualKickoff = match?.fixture?.date ? new Date(match.fixture.date) : null;
  const meta: LookupMeta = { actualKickoff: actualKickoff && !isNaN(actualKickoff.getTime()) ? actualKickoff : null, matchedBy };

  // ORIENTATION GUARD. Every market resolves `selection` against the home/away
  // ordering of the score we return, so if our row has the teams the other way
  // round from the provider, a correct scoreline still produces an inverted
  // outcome. This is not hypothetical: "Inter vs Cagliari" was stored with Inter
  // at home for a fixture the provider lists as Cagliari vs Inter, and the pick
  // "Inter to win" (selection HOME) would have settled LOST off a 0-1 Inter win.
  //
  // The date path cannot hit this — namesLikelyMatch already pins home to home
  // and away to away — but the id path matches on identity alone, so it must
  // check explicitly. Flagged for a human rather than silently re-oriented: a
  // row whose teams are backwards may have reasoning written the wrong way round
  // too, and that is an editorial call, not a settlement one.
  const provHome = match?.teams?.home?.id;
  const provAway = match?.teams?.away?.id;
  if (ours?.homeTeamApiId != null && ours?.awayTeamApiId != null && provHome != null && provAway != null) {
    if (provHome === ours.awayTeamApiId && provAway === ours.homeTeamApiId) {
      return {
        status: "manual_required",
        reason: `stored teams are reversed relative to the fixture (provider has ${match.teams.home.name} at home); settling would invert every home/away selection`,
        ...meta,
      };
    }
    if (provHome !== ours.homeTeamApiId || provAway !== ours.awayTeamApiId) {
      return {
        status: "manual_required",
        reason: `fixture id resolves to a different pairing (${match.teams.home.name} vs ${match.teams.away.name})`,
        ...meta,
      };
    }
  }
  if (!FINISHED_STATUSES.has(match.fixture.status.short)) return { status: "not_finished", ...meta };
  const regulation = regulationScoreOf(match);
  if (!regulation.ok) return { status: "manual_required", reason: regulation.reason, ...meta };
  return { status: "scored", homeScore: regulation.home, awayScore: regulation.away, halftime: regulation.halftime, ...meta };
}

export async function lookupFinishedScore(input: {
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  /** Provider fixture id when the row has one — the exact path. */
  fixtureApiId?: number | null;
  /** Stored provider team ids, used to verify orientation on the id path. */
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  /** Batch fetched by the caller, so this does no network call of its own. */
  prefetched?: Map<number, any>;
}): Promise<ScoreLookupResult> {
  // ---- Exact path: resolve by provider fixture id ------------------------
  // Immune to reschedules (the id survives a date change) and to name
  // spelling, so it never produces the "matched both team names" failure that
  // stranded rows indefinitely.
  if (input.fixtureApiId != null) {
    let match = input.prefetched?.get(input.fixtureApiId);
    if (!match) {
      const rows = await getFixturesByIds([input.fixtureApiId]);
      // rows === null is a FAILED call — fall through to the date path rather
      // than declaring a fixture that exists to be missing. An empty array is
      // a successful "no such fixture", which the date path cannot improve on.
      if (rows === null) match = undefined;
      else if (rows.length === 0) return { status: "not_found", reason: `provider has no fixture with id ${input.fixtureApiId}`, matchedBy: "id" };
      else match = rows[0];
    }
    if (match) return classify(match, "id", { homeTeamApiId: input.homeTeamApiId, awayTeamApiId: input.awayTeamApiId });
  }

  // ---- Fallback: date + team-name matching ------------------------------
  // Kept for rows generated before fixtureApiId existed and for hand-entered
  // admin rows. Inherently fragile: it queries exactly ONE date, so a fixture
  // rescheduled across midnight is invisible to it no matter how well the
  // names match.
  const dateStr = input.kickoff.toISOString().slice(0, 10);
  const fixtures = await getFixturesByDate(dateStr);
  if (!fixtures?.length) return { status: "not_found", reason: "no fixtures returned for that date (plan restriction or genuinely none)", matchedBy: "date" };

  const match = fixtures.find((f) => namesLikelyMatch(f.teams.home.name, input.homeTeam) && namesLikelyMatch(f.teams.away.name, input.awayTeam));
  if (!match) return { status: "not_found", reason: "no fixture on that date matched both team names", matchedBy: "date" };
  if (!FINISHED_STATUSES.has(match.fixture.status.short)) return { status: "not_finished", matchedBy: "date", actualKickoff: new Date(match.fixture.date) };
  const regulation = regulationScoreOf(match);
  if (!regulation.ok) return { status: "manual_required", reason: regulation.reason, matchedBy: "date", actualKickoff: new Date(match.fixture.date) };

  // Halftime rides along on the SAME /fixtures response — no extra call. It is
  // null only when the feed omits it, which the coverage check
  // (scripts/research-halftime-coverage.ts) measured at 0 of 1,179 finished
  // fixtures across all 34 competitions. Passed through rather than assumed so
  // WIN_EITHER_HALF degrades to manual review if that ever changes.
  return { status: "scored", homeScore: regulation.home, awayScore: regulation.away, halftime: regulation.halftime, matchedBy: "date", actualKickoff: new Date(match.fixture.date) };
}
