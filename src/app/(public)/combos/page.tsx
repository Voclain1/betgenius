import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import { CATEGORY_NAMES } from "@/lib/categoryPredictions";
import type { PredictionCategory } from "@/lib/enums";
import { ComboCard, type ComboView } from "@/components/ComboCard";
import { comboIsUpcoming } from "@/lib/combos";
import { AffiliateDisclosure } from "@/components/AffiliateDisclosure";

export default async function CombosPage() {
  const session = await getServerSession(authOptions);

  const allCombos = await prisma.combo.findMany({
    where: { published: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, description: true, category: true, legs: { select: { predictionId: true } } },
  });
  const predictionIds = [...new Set(allCombos.flatMap((combo) => combo.legs.map((leg) => leg.predictionId).filter((id): id is string => !!id)))];
  const predictionKickoffs = predictionIds.length
    ? await prisma.prediction.findMany({ where: { id: { in: predictionIds } }, select: { id: true, kickoff: true } })
    : [];
  const kickoffByPrediction = new Map(predictionKickoffs.map((prediction) => [prediction.id, prediction.kickoff]));
  const combos = allCombos.filter((combo) => comboIsUpcoming(combo.legs.map((leg) => leg.predictionId ? kickoffByPrediction.get(leg.predictionId) ?? null : null)));

  const unlocked = combos.filter((c) =>
    canViewCategory(c.category as PredictionCategory, session?.user.tier, session?.user.subStatus, session?.user.role),
  );
  const unlockedIds = new Set(unlocked.map((c) => c.id));

  // Locked combos never get their leg data fetched — same defense-in-depth
  // standard as Bet Builder and the dashboard: nothing gated reaches the
  // client for a category the viewer can't see.
  const legs = unlocked.length
    ? await prisma.comboLeg.findMany({
        where: { comboId: { in: [...unlockedIds] } },
        orderBy: { order: "asc" },
        select: { id: true, comboId: true, matchLabel: true, market: true, pick: true },
      })
    : [];
  const legsByCombo = new Map<string, typeof legs>();
  for (const leg of legs) {
    const arr = legsByCombo.get(leg.comboId) ?? [];
    arr.push(leg);
    legsByCombo.set(leg.comboId, arr);
  }

  const bookmakers = await prisma.bookmaker.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, affiliateUrl: true, logoUrl: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Combos</h1>
        <p className="text-sm text-gray-400">Editorially curated accumulators built from our published tips.</p>
      </div>

      {bookmakers.length > 0 && <AffiliateDisclosure compact />}

      {combos.length === 0 ? (
        <p className="text-sm text-gray-400">No combos published yet — check back soon.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {combos.map((c) => {
            const view: ComboView = {
              id: c.id,
              title: c.title,
              description: c.description,
              category: c.category,
              legs: (legsByCombo.get(c.id) ?? []).map(({ comboId, ...leg }) => leg),
            };
            return (
              <ComboCard
                key={c.id}
                combo={view}
                locked={!unlockedIds.has(c.id)}
                categoryLabel={CATEGORY_NAMES[c.category as PredictionCategory]}
                bookmakers={bookmakers}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
