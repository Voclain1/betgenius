import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import { CATEGORY_NAMES, getCategoryPredictions } from "@/lib/categoryPredictions";
import { PREDICTION_CATEGORIES, type PredictionCategory } from "@/lib/enums";
import { BetBuilderClient } from "@/components/BetBuilderClient";
import type { TipCategory, TipOption } from "@/components/TipsPicker";

export default async function BetBuilderPage() {
  const session = await getServerSession(authOptions);

  // Same gating as everywhere else — canViewCategory() fed from the session,
  // works for a logged-out visitor too (FEATURED/GENIUS/TODAY are public).
  const canViewMap = Object.fromEntries(
    PREDICTION_CATEGORIES.map((cat) => [
      cat,
      canViewCategory(cat, session?.user.tier, session?.user.subStatus, session?.user.role),
    ]),
  ) as Record<PredictionCategory, boolean>;
  const unlockedCategories = PREDICTION_CATEGORIES.filter((cat) => canViewMap[cat]);

  // Locked categories never get their rows fetched at all — defense in
  // depth, same pattern as the dashboard: nothing gated ever reaches the
  // client for a category the viewer can't see.
  const optionsByCategory = Object.fromEntries(
    await Promise.all(
      unlockedCategories.map(async (cat) => {
        const rows = await getCategoryPredictions(cat);
        const options: TipOption[] = rows
          .filter((r): r is typeof r & { odds: number } => r.odds != null)
          .map((r) => {
            const home = r.homeTeam ?? r.fixture?.homeTeam.name;
            const away = r.awayTeam ?? r.fixture?.awayTeam.name;
            return {
              id: r.id,
              label: home && away ? `${home} vs ${away}` : "Match TBD",
              market: r.market,
              pick: r.pick,
              odds: r.odds,
            };
          });
        return [cat, options] as const;
      }),
    ),
  ) as Record<PredictionCategory, TipOption[]>;

  const categories: TipCategory[] = PREDICTION_CATEGORIES.map((cat) => ({
    key: cat,
    label: CATEGORY_NAMES[cat],
    locked: !canViewMap[cat],
    options: optionsByCategory[cat] ?? [],
  }));

  const bookmakers = await prisma.bookmaker.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, affiliateUrl: true, logoUrl: true },
  });

  return (
    <Suspense fallback={null}>
      <BetBuilderClient categories={categories} bookmakers={bookmakers} />
    </Suspense>
  );
}
