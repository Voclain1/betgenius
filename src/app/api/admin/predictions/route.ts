import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { setPredictionCategories } from "@/lib/predictions";
import { z } from "zod";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const items = await prisma.prediction.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { author: true, approvedBy: true, categories: true, fixture: { include: { homeTeam: true, awayTeam: true } } },
  });
  return NextResponse.json({ items });
}

const CreateBody = z.object({
  fixtureId: z.string().optional(),
  categories: z.array(z.enum(["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM"])).min(1),
  leagueApiId: z.number().optional(),
  leagueName: z.string().optional(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  kickoff: z.coerce.date().optional(),
  market: z.string(),
  pick: z.string(),
  overUnder: z.string().min(1),
  odds: z.number().optional(),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
  matchPreview: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = CreateBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { categories, ...rest } = parsed.data;
  const p = await prisma.prediction.create({
    data: { ...rest, category: categories[0], authorId: session!.user.id, status: "PENDING_REVIEW" },
  });
  await setPredictionCategories(p.id, categories);
  return NextResponse.json({ prediction: p });
}
