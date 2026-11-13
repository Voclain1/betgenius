import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory, presentedCategory } from "@/lib/access";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { PREDICTION_CATEGORIES, type PredictionCategory } from "@/lib/enums";
import { lagosTodayBounds } from "@/lib/lagosDate";
import { orderForDisplay } from "@/lib/predictionOrdering";
import { stripUnsupportedStaff } from "@/lib/ai/staffClaims";
import { lockedPredictionView, rowViewable } from "@/lib/lockedPrediction";
import { NOT_PAID_ONLY } from "@/lib/paidOnly";

// The answer depends on who is asking: never cached by a shared cache or CDN.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("category")?.toUpperCase();
  const category = (raw && (PREDICTION_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as PredictionCategory)
    : undefined);

  const viewer = await getViewerEntitlement();
  const { tier, status, role } = viewer;

  const today = lagosTodayBounds();
  const unordered = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      ...(category
        ? {
            kickoff: { gte: today.start, lt: today.end },
            ...(category === "TODAY" ? {} : { categories: { some: { category } } }),
            // Paid-only picks belong to VIP and Premium alone, exactly as the
            // feed pages decide it (categoryFeedWhere).
            ...(category === "VIP" || category === "PREMIUM" ? {} : NOT_PAID_ONLY),
          }
        : {}),
    },
    // See getCategoryPredictions: a deterministic cut of the day, re-ranked
    // below into the order every surface displays picks in.
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    take: 60,
    include: {
      fixture: { include: { homeTeam: true, awayTeam: true, league: true } },
      author: { select: { name: true } },
      categories: true,
    },
  });

  const rows = orderForDisplay(unordered);

  const shaped = rows.map((r) => {
    // Gate on the requested category page when one is set; otherwise a row is
    // visible if it's unlocked under ANY of its assigned categories.
    const gateCategory = category ?? r.categories.find((c) => canViewCategory(c.category as PredictionCategory, tier, status, role))?.category ?? presentedCategory(r.category, r.categories);
    // Decided by the row as well as the feed: a paid-only pick needs paid access
    // whatever feed it was requested through (src/lib/lockedPrediction.ts).
    const canView = rowViewable(r, canViewCategory(gateCategory as PredictionCategory, tier, status, role), (c) => canViewCategory(c as PredictionCategory, tier, status, role));
    const teams = { coaches: [], teams: [r.homeTeam, r.awayTeam] };
    return canView
      ? { ...r, reasoning: stripUnsupportedStaff(r.reasoning, teams), matchPreview: r.matchPreview && stripUnsupportedStaff(r.matchPreview, teams) }
      // Allowlist: the fixture, never the pick (see src/lib/lockedPrediction.ts).
      : lockedPredictionView(r);
  });

  return NextResponse.json(shaped, { headers: { "Cache-Control": "private, no-store" } });
}
