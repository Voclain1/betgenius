import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { generateAndPersistPrediction } from "@/lib/ai/generate";
import { z } from "zod";

const Body = z.object({
  fixtureId: z.string().optional(),
  home: z.string().min(1),
  away: z.string().min(1),
  league: z.string().min(1),
  leagueApiId: z.number().optional(),
  kickoff: z.string(),
  category: z.enum(["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM"]).default("TODAY"),
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
        model: process.env.GEMINI_MODEL || "gemini-flash-latest",
        rawOutput: String(err?.message ?? err),
        status: "FAILED",
      },
    });
    return NextResponse.json({ error: err?.message ?? "AI generation failed" }, { status: 500 });
  }
}
