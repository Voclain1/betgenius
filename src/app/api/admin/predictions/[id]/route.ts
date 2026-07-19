import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { setPredictionCategories } from "@/lib/predictions";
import { MARKET_TYPES, isValidSelection, deriveMarketAndPick, deriveOverUnderText } from "@/lib/markets";
import { z } from "zod";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const prediction = await prisma.prediction.findUnique({
    where: { id: params.id },
    include: {
      categories: true,
      fixture: { include: { homeTeam: true, awayTeam: true, league: true } },
      author: { select: { name: true, email: true } },
    },
  });
  if (!prediction) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ prediction });
}

const Patch = z.object({
  action: z.enum(["APPROVE", "PUBLISH", "ARCHIVE", "EDIT"]),
  patch: z
    .object({
      odds: z.number().optional(),
      confidence: z.number().min(0).max(100).optional(),
      reasoning: z.string().optional(),
      matchPreview: z.string().optional(),
      categories: z.array(z.enum(["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM"])).min(1).optional(),
      leagueApiId: z.number().nullable().optional(),
      leagueName: z.string().nullable().optional(),
      homeTeam: z.string().nullable().optional(),
      awayTeam: z.string().nullable().optional(),
      kickoff: z.coerce.date().nullable().optional(),
      marketType: z.enum(MARKET_TYPES).optional(),
      selection: z.any().optional(),
      otherMarket: z.string().optional(),
      otherPick: z.string().optional(),
      ouLine: z.number().positive().nullable().optional(),
      ouDirection: z.enum(["OVER", "UNDER"]).nullable().optional(),
    })
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Patch.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { action, patch } = parsed.data;

  const { categories, marketType, selection, otherMarket, otherPick, ouLine, ouDirection, ...rest } = patch ?? {};
  const data: any = { ...rest };

  if (marketType) {
    if (marketType === "OTHER") {
      if (!otherMarket || !otherPick) {
        return NextResponse.json({ error: "market and pick are required when market type is Other" }, { status: 400 });
      }
      data.marketType = marketType;
      data.selection = Prisma.DbNull;
      data.manualSettlementOnly = true;
      data.market = otherMarket;
      data.pick = otherPick;
    } else if (!isValidSelection(marketType, selection)) {
      return NextResponse.json({ error: `Selection is incomplete for market type ${marketType}` }, { status: 400 });
    } else {
      const { market, pick } = deriveMarketAndPick(marketType, selection, rest.homeTeam ?? undefined, rest.awayTeam ?? undefined);
      data.marketType = marketType;
      data.selection = selection;
      data.manualSettlementOnly = false;
      data.market = market;
      data.pick = pick;
    }
  }

  if (ouLine !== undefined || ouDirection !== undefined) {
    data.ouLine = ouLine ?? null;
    data.ouDirection = ouDirection ?? null;
    data.overUnder = deriveOverUnderText(data.ouLine, data.ouDirection);
  }

  if (action === "APPROVE") {
    data.status = "APPROVED";
    data.approvedById = session!.user.id;
    data.approvedAt = new Date();
  } else if (action === "PUBLISH") {
    data.status = "PUBLISHED";
    data.publishedAt = new Date();
    if (!data.approvedById) {
      data.approvedById = session!.user.id;
      data.approvedAt = new Date();
    }
  } else if (action === "ARCHIVE") {
    data.status = "ARCHIVED";
  }

  if (categories) await setPredictionCategories(params.id, categories);
  const updated = await prisma.prediction.update({
    where: { id: params.id },
    data,
    include: { categories: true },
  });
  return NextResponse.json({ prediction: updated });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.prediction.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
