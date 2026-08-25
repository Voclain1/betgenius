import { getFixturesByDate } from "@/lib/football/api-football";

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

export type ScoreLookupResult =
  // `halftime` is null only when the feed omits it — see lookupFinishedScore.
  // Markets that need the halves (WIN_EITHER_HALF) resolve to null in that
  // case and are flagged for manual settlement rather than guessed.
  | { status: "scored"; homeScore: number; awayScore: number; halftime: { home: number; away: number } | null }
  | { status: "not_finished" }
  | { status: "manual_required"; reason: string }
  | { status: "not_found"; reason: string };

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
export async function lookupFinishedScore(input: { homeTeam: string; awayTeam: string; kickoff: Date }): Promise<ScoreLookupResult> {
  const dateStr = input.kickoff.toISOString().slice(0, 10);
  const fixtures = await getFixturesByDate(dateStr);
  if (!fixtures?.length) return { status: "not_found", reason: "no fixtures returned for that date (plan restriction or genuinely none)" };

  const match = fixtures.find((f) => namesLikelyMatch(f.teams.home.name, input.homeTeam) && namesLikelyMatch(f.teams.away.name, input.awayTeam));
  if (!match) return { status: "not_found", reason: "no fixture on that date matched both team names" };
  if (!FINISHED_STATUSES.has(match.fixture.status.short)) return { status: "not_finished" };
  const regulation = regulationScoreOf(match);
  if (!regulation.ok) return { status: "manual_required", reason: regulation.reason };

  // Halftime rides along on the SAME /fixtures response — no extra call. It is
  // null only when the feed omits it, which the coverage check
  // (scripts/research-halftime-coverage.ts) measured at 0 of 1,179 finished
  // fixtures across all 34 competitions. Passed through rather than assumed so
  // WIN_EITHER_HALF degrades to manual review if that ever changes.
  return { status: "scored", homeScore: regulation.home, awayScore: regulation.away, halftime: regulation.halftime };
}
