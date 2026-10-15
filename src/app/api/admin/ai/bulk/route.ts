import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { generateAndPersistPrediction } from "@/lib/ai/generate";
import { getFixturesByLeague, resolveSeason, type FixtureRow } from "@/lib/football/api-football";
import { LEAGUE_CATALOGUE } from "@/lib/leagues";
import { getUsageSnapshot } from "@/lib/football/usage";
import { excludeCoveredFixtures } from "@/lib/generation/existingCoverage";
import { BULK_TIME_BUDGET_MS, bulkFailureReason } from "@/lib/generation/bulkRun";
import { z } from "zod";

// A bulk run is sequential and already slow: ~11 throttled api-football calls
// plus a Gemini call per fixture, up to 20 fixtures. Gemini's 503 retries can
// now add up to ~17s per fixture on top. Without this the route would inherit
// the 15s default and die mid-batch, which is the exact half-finished state the
// quota trim below exists to prevent. Matches settle/refresh-enrichment.
export const maxDuration = 300;

// Bulk generation is scoped to free-tier categories only — VIP/PREMIUM tips
// stay a deliberate, manual, one-at-a-time admin action.
const FREE_CATEGORIES = ["FEATURED", "GENIUS", "BANKER"] as const;

const Body = z.object({
  date: z.string().min(1), // YYYY-MM-DD
  leagueApiIds: z.array(z.number()).min(1),
  categories: z.array(z.enum(FREE_CATEGORIES)).min(1),
  limit: z.number().min(1).max(20).default(10),
});

export async function POST(req: Request) {
  const startedAt = Date.now();
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { date, leagueApiIds, categories, limit } = parsed.data;
  const dateObj = new Date(date);
  const leagueNameById = new Map<number, string>(LEAGUE_CATALOGUE.map((l) => [l.id, l.name]));

  // Season boundaries differ per league (winter-spanning vs. calendar-year),
  // so each league's season must be resolved individually for this date.
  const fixturesByLeague: (FixtureRow[] | null)[] = [];
  for (const id of leagueApiIds) {
    const season = await resolveSeason(id, dateObj);
    fixturesByLeague.push(await getFixturesByLeague(id, season, date, date));
  }
  // Each generateAndPersistPrediction costs roughly 11 api-football calls
  // (2x searchTeam, 2x getTeamContext at 3 apiece, standings, h2h, and a
  // possible resolveSeason miss). Trim the batch to what today's remaining
  // quota can actually cover rather than starting a run that dies partway
  // through — a half-finished bulk generate leaves fixtures with empty context
  // (contextComplete: false) that an admin then has to find and redo.
  const CALLS_PER_FIXTURE = 11;
  const { remaining } = await getUsageSnapshot();
  const affordable = Math.floor(remaining / CALLS_PER_FIXTURE);

  const notStarted = fixturesByLeague
    .flat()
    .filter((f): f is FixtureRow => !!f && f.fixture.status.short === "NS");
  // Fixtures that already have live or in-review tips (from the scheduler or an
  // earlier run) are left out BEFORE the limit, so "Max fixtures" counts only
  // matches that need tips and no fixture gets a second set.
  const { open: candidates, covered } = await excludeCoveredFixtures(notStarted);
  const upcoming = candidates.slice(0, Math.min(limit, affordable));

  if (candidates.length > 0 && upcoming.length === 0) {
    return NextResponse.json(
      { error: "api-football daily quota exhausted — no budget left to generate today.", found: candidates.length, alreadyCovered: covered, quotaRemaining: remaining },
      { status: 429 },
    );
  }

  // Generate sequentially — avoids hammering the AI/football APIs with a burst of parallel calls.
  //
  // Stops starting new fixtures once BULK_TIME_BUDGET_MS has gone (counted from the start of the request), so a long batch
  // returns what it finished instead of being killed at maxDuration (which the
  // panel saw as the whole run failing, with nothing reported).
  const results: Array<{ home: string; away: string; ok: boolean; predictionIds?: string[]; contextComplete?: boolean; error?: string }> = [];
  const notReached: Array<{ home: string; away: string }> = [];
  for (const f of upcoming) {
    if (Date.now() - startedAt > BULK_TIME_BUDGET_MS) {
      notReached.push({ home: f.teams.home.name, away: f.teams.away.name });
      continue;
    }
    try {
      const { predictions } = await generateAndPersistPrediction({
        home: f.teams.home.name,
        away: f.teams.away.name,
        league: leagueNameById.get(f.league.id) ?? f.league.name,
        leagueApiId: f.league.id,
        fixtureApiId: f.fixture.id,
        kickoff: f.fixture.date,
        round: f.league.round ?? null,
        categories: [...categories],
        authorId: session!.user.id,
      });
      results.push({
        home: f.teams.home.name,
        away: f.teams.away.name,
        ok: true,
        predictionIds: predictions.map((p) => p.id),
        contextComplete: predictions[0]?.contextComplete,
      });
    } catch (err: any) {
      console.error("[api/admin/ai/bulk]", `${f.teams.home.name} v ${f.teams.away.name}`, err);
      results.push({ home: f.teams.home.name, away: f.teams.away.name, ok: false, error: bulkFailureReason(err) });
    }
  }

  return NextResponse.json({
    found: upcoming.length,
    // Surfaced so a truncated batch is visible to the admin rather than looking
    // like the league simply had fewer fixtures than expected.
    skippedForQuota: Math.max(0, Math.min(limit, candidates.length) - upcoming.length),
    // Not generated because they already have tips; each links to the existing one.
    alreadyCovered: covered,
    // Left for the next run: the time budget ran out before they started.
    notReached,
    quotaRemaining: (await getUsageSnapshot()).remaining,
    results,
  });
}
