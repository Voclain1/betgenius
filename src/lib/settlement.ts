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
  | { status: "scored"; homeScore: number; awayScore: number }
  | { status: "not_finished" }
  | { status: "not_found"; reason: string };

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
  if (match.goals.home == null || match.goals.away == null) return { status: "not_found", reason: "finished fixture has no score" };

  return { status: "scored", homeScore: match.goals.home, awayScore: match.goals.away };
}
