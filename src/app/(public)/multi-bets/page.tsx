import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import { CATEGORY_NAMES } from "@/lib/categoryPredictions";
import type { PredictionCategory } from "@/lib/enums";
import { ComboCard, type ComboView } from "@/components/ComboCard";
import { comboIsUpcoming } from "@/lib/combos";
import { AffiliateDisclosure } from "@/components/AffiliateDisclosure";

export default async function MultiBetsPage() {
  const session = await getServerSession(authOptions);

  const allCombos = await prisma.combo.findMany({
    where: { published: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, description: true, category: true, oddsTier: true, legs: { select: { predictionId: true } } },
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
        select: { id: true, comboId: true, matchLabel: true, market: true, pick: true, odds: true },
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

  // Grouped by tier ASCENDING, then the hand-built combos last.
  //
  // Ascending because the ladder is meant to be climbed: the 3x is the one a
  // reader is most likely to actually place, and leading with the 50x would
  // put the longest shot on the page at the top and read as a lottery ticket
  // rather than as the end of a range.
  //
  // The manual Multi Bets keep their place on this page rather than moving
  // elsewhere — they are the same kind of thing, they simply have no tier and
  // no prices, which is exactly what oddsTier being null says.
  const tiered = combos.filter((c) => c.oddsTier != null).sort((a, b) => a.oddsTier! - b.oddsTier!);
  const manual = combos.filter((c) => c.oddsTier == null);
  // A tier holds ONE card on a normal day (the pass is idempotent per tier per
  // day), so the three-column grid the manual combos use would leave two thirds
  // of every tier row empty. These sections get a single column in a narrower
  // container instead: the card fills its width rather than being a third of a
  // row with nothing beside it, and a tier that happens to carry two cards —
  // yesterday's ladder can still be upcoming alongside today's — stacks them
  // rather than reflowing into a half-empty row.
  //
  // `layout` rather than a conditional on `key`: the manual section keeps the
  // grid it has always had, and the difference between the two is stated as
  // data rather than inferred from a string comparison at render time.
  const sections: {
    key: string;
    heading: string;
    blurb: string;
    layout: "stack" | "grid";
    combos: typeof combos;
  }[] = [
    ...[...new Set(tiered.map((c) => c.oddsTier!))].map((tier) => ({
      key: `tier-${tier}`,
      heading: `${tier}x`,
      blurb: `Targeting a combined ${tier}x return. Every leg is a published tip priced at a real, multi-bookmaker quote.`,
      layout: "stack" as const,
      combos: tiered.filter((c) => c.oddsTier === tier),
    })),
    ...(manual.length
      ? [
          {
            key: "manual",
            heading: "Editor's multi bets",
            blurb: "Hand-built accumulators from our published tips.",
            layout: "grid" as const,
            combos: manual,
          },
        ]
      : []),
  ].filter((s) => s.combos.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Multi Bets</h1>
        <p className="text-sm text-gray-400">Multi bet accumulators spanning several fixtures, each leg taken from our published football tips.</p>
      </div>

      {bookmakers.length > 0 && <AffiliateDisclosure compact />}

      {combos.length === 0 ? (
        <p className="text-sm text-gray-400">No multi bets published yet — check back soon.</p>
      ) : (
        <div className="space-y-10">
          {sections.map((section) => (
            <section key={section.key}>
              <h2 className="mb-1 text-lg font-semibold">{section.heading}</h2>
              <p className="mb-3 text-sm text-gray-400">{section.blurb}</p>
              <div
                className={
                  section.layout === "stack"
                    ? "grid max-w-2xl grid-cols-1 gap-4"
                    : "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
                }
              >
                {section.combos.map((c) => (
                  <ComboCard
                    key={c.id}
                    combo={{
                      id: c.id,
                      title: c.title,
                      description: c.description,
                      category: c.category,
                      oddsTier: c.oddsTier,
                      legs: (legsByCombo.get(c.id) ?? []).map(({ comboId, ...leg }) => leg),
                    }}
                    locked={!unlockedIds.has(c.id)}
                    categoryLabel={CATEGORY_NAMES[c.category as PredictionCategory]}
                    bookmakers={bookmakers}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
