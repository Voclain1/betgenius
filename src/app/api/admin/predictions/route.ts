import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { setPredictionCategories } from "@/lib/predictions";
import { MARKET_TYPES, isValidSelection, deriveMarketAndPick, deriveOverUnderText } from "@/lib/markets";
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
  marketType: z.enum(MARKET_TYPES),
  selection: z.any().optional(),
  otherMarket: z.string().optional(),
  otherPick: z.string().optional(),
  ouLine: z.number().positive(),
  ouDirection: z.enum(["OVER", "UNDER"]),
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
  const { categories, marketType, selection, otherMarket, otherPick, ouLine, ouDirection, ...rest } = parsed.data;

  if (marketType === "OTHER") {
    if (!otherMarket || !otherPick) {
      return NextResponse.json({ error: "market and pick are required when market type is Other" }, { status: 400 });
    }
  } else if (!isValidSelection(marketType, selection)) {
    return NextResponse.json({ error: `Selection is incomplete for market type ${marketType}` }, { status: 400 });
  }

  const { market, pick } =
    marketType === "OTHER" ? { market: otherMarket!, pick: otherPick! } : deriveMarketAndPick(marketType, selection, rest.homeTeam, rest.awayTeam);

  const p = await prisma.prediction.create({
    data: {
      ...rest,
      category: categories[0],
      marketType,
      selection: marketType === "OTHER" ? undefined : selection,
      manualSettlementOnly: marketType === "OTHER",
      market,
      pick,
      ouLine,
      ouDirection,
      overUnder: deriveOverUnderText(ouLine, ouDirection),
      authorId: session!.user.id,
      status: "PENDING_REVIEW",
    },
  });
  await setPredictionCategories(p.id, categories);
  return NextResponse.json({ prediction: p });
}
