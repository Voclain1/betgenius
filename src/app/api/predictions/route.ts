import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import { PREDICTION_CATEGORIES, type PredictionCategory } from "@/lib/enums";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("category")?.toUpperCase();
  const category = (raw && (PREDICTION_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as PredictionCategory)
    : undefined);

  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const tier = session?.user?.tier;
  const status = session?.user?.subStatus;

  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", ...(category ? { categories: { some: { category } } } : {}) },
    orderBy: [{ publishedAt: "desc" }],
    take: 60,
    include: {
      fixture: { include: { homeTeam: true, awayTeam: true, league: true } },
      author: { select: { name: true } },
      categories: true,
    },
  });

  const shaped = rows.map((r) => {
    // Gate on the requested category page when one is set; otherwise a row is
    // visible if it's unlocked under ANY of its assigned categories.
    const gateCategory = category ?? r.categories.find((c) => canViewCategory(c.category as PredictionCategory, tier, status, role))?.category ?? (r.category as PredictionCategory);
    const canView = canViewCategory(gateCategory as PredictionCategory, tier, status, role);
    return canView
      ? r
      : {
          ...r,
          pick: "LOCKED",
          reasoning: "Subscribe to unlock this prediction.",
          matchPreview: null,
          confidence: null,
          odds: null,
          locked: true,
        };
  });

  return NextResponse.json(shaped);
}