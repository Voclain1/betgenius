import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { generateAndPersistPrediction } from "@/lib/ai/generate";
import { DEFAULT_GEMINI_MODEL } from "@/lib/ai/providers/gemini";
import { z } from "zod";

// One fixture: ~11 throttled api-football calls plus a Gemini call that can
// now spend up to ~17s retrying a 503. The 15s default left no room for either.
// 60 matches the rewrite route, which does the same work minus the context fetch.
export const maxDuration = 60;

const Body = z.object({
  fixtureId: z.string().optional(),
  home: z.string().min(1),
  away: z.string().min(1),
  league: z.string().min(1),
  leagueApiId: z.number().optional(),
  kickoff: z.string(),
  category: z.enum(["FEATURED", "GENIUS", "BANKER", "VIP", "PREMIUM"]).default("FEATURED"),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const input = parsed.data;

  try {
    const result = await generateAndPersistPrediction({
      fixtureId: input.fixtureId,
      home: input.home,
      away: input.away,
      league: input.league,
      leagueApiId: input.leagueApiId,
      kickoff: input.kickoff,
      categories: [input.category],
      authorId: session!.user.id,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[api/admin/ai]", err);
    await prisma.aIJob.create({
      data: {
        userId: session!.user.id,
        prompt: JSON.stringify(input),
        // Same resolution the provider chain uses, so a failed job records the
        // model that was actually attempted rather than a stale alias.
        model: `gemini:${process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL}`,
        rawOutput: String(err?.message ?? err),
        status: "FAILED",
      },
    });
    return NextResponse.json({ error: "Prediction generation failed. Try again shortly." }, { status: 500 });
  }
}
