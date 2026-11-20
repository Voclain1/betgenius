import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { generateAndPersistPrediction } from "@/lib/ai/generate";
import { DEFAULT_GEMINI_MODEL } from "@/lib/ai/providers/gemini";
import { DEFAULT_ANTHROPIC_MODEL } from "@/lib/ai/providers/anthropic";
import { z } from "zod";
import { leagueTeamMismatch, LEAGUE_TEAM_MISMATCH } from "@/lib/leagueTeamCheck";

// One fixture: ~11 throttled api-football calls plus a Gemini call that can
// now spend up to ~17s retrying a 503. The 15s default left no room for either.
// 60 matches the rewrite route, which does the same work minus the context fetch.
export const maxDuration = 60;

const Body = z.object({
  fixtureId: z.string().optional(),
  // Optional: the admin UI supplies it when the fixture came from a provider
  // slate, and omits it for a hand-typed match. Absent means the row keeps the
  // date+name settlement fallback.
  fixtureApiId: z.number().int().positive().optional(),
  home: z.string().min(1),
  away: z.string().min(1),
  league: z.string().min(1),
  leagueApiId: z.number().optional(),
  kickoff: z.string(),
  category: z.enum(["FEATURED", "GENIUS", "BANKER", "VIP", "PREMIUM"]).default("FEATURED"),
  /** The admin saw the "teams do not match this competition" warning and chose to continue. */
  leagueConfirmed: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const input = parsed.data;

  // A hand-typed match filed under a competition neither team plays in would
  // show on that competition's page. Stop and ask, once.
  if (!input.leagueConfirmed) {
    const mismatch = await leagueTeamMismatch({ leagueApiId: input.leagueApiId, leagueName: input.league, home: input.home, away: input.away, fixtureApiId: input.fixtureApiId });
    if (mismatch) return NextResponse.json({ error: mismatch, code: LEAGUE_TEAM_MISMATCH }, { status: 409 });
  }

  try {
    const result = await generateAndPersistPrediction({
      fixtureId: input.fixtureId,
      fixtureApiId: input.fixtureApiId,
      home: input.home,
      away: input.away,
      league: input.league,
      leagueApiId: input.leagueApiId,
      kickoff: input.kickoff,
      categories: [input.category],
      authorId: session!.user.id,
      // The admin chose this match: no short-price rule (src/lib/shortPriceGuard.ts).
      manual: true,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[api/admin/ai]", err);
    await prisma.aIJob.create({
      data: {
        userId: session!.user.id,
        prompt: JSON.stringify(input),
        // The chain's first configured provider, resolved the way the chain
        // resolves it, so a failed job records the model actually attempted.
        model: process.env.ANTHROPIC_API_KEY
          ? `anthropic:${process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL}`
          : `gemini:${process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL}`,
        rawOutput: String(err?.message ?? err),
        status: "FAILED",
      },
    });
    return NextResponse.json({ error: "Prediction generation failed. Try again shortly." }, { status: 500 });
  }
}
