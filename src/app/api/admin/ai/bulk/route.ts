import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { generateAndPersistPrediction } from "@/lib/ai/generate";
import { getFixturesByLeague, resolveSeason, type FixtureRow } from "@/lib/football/api-football";
import { MAJOR_LEAGUES } from "@/lib/leagues";
import { z } from "zod";

// Bulk generation is scoped to free-tier categories only — VIP/PREMIUM tips
// stay a deliberate, manual, one-at-a-time admin action.
const FREE_CATEGORIES = ["FEATURED", "GENIUS", "TODAY", "BANKER"] as const;

const Body = z.object({
  date: z.string().min(1), // YYYY-MM-DD
  leagueApiIds: z.array(z.number()).min(1),
  categories: z.array(z.enum(FREE_CATEGORIES)).min(1),
  limit: z.number().min(1).max(20).default(10),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { date, leagueApiIds, categories, limit } = parsed.data;
  const dateObj = new Date(date);
  const leagueNameById = new Map<number, string>(MAJOR_LEAGUES.map((l) => [l.id, l.name]));

  // Season boundaries differ per league (winter-spanning vs. calendar-year),
  // so each league's season must be resolved individually for this date.
  const fixturesByLeague: (FixtureRow[] | null)[] = [];
  for (const id of leagueApiIds) {
    const season = await resolveSeason(id, dateObj);
    fixturesByLeague.push(await getFixturesByLeague(id, season, date, date));
  }
  const upcoming = fixturesByLeague
    .flat()
    .filter((f): f is FixtureRow => !!f && f.fixture.status.short === "NS")
    .slice(0, limit);

  // Generate sequentially — avoids hammering the AI/football APIs with a burst of parallel calls.
  const results: Array<{ home: string; away: string; ok: boolean; predictionIds?: string[]; contextComplete?: boolean; error?: string }> = [];
  for (const f of upcoming) {
    try {
      const { predictions } = await generateAndPersistPrediction({
        home: f.teams.home.name,
        away: f.teams.away.name,
        league: leagueNameById.get(f.league.id) ?? f.league.name,
        leagueApiId: f.league.id,
        kickoff: f.fixture.date,
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
      results.push({ home: f.teams.home.name, away: f.teams.away.name, ok: false, error: err?.message ?? String(err) });
    }
  }

  return NextResponse.json({ found: upcoming.length, results });
}
