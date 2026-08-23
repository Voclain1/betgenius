import { prisma } from "@/lib/prisma";

export type ComboLegInput = {
  matchLabel: string;
  market: string;
  pick: string;
  predictionId?: string | null;
};

/**
 * Replaces a combo's legs wholesale, in the given order — mirrors
 * setPredictionCategories's delete+recreate approach: the admin UI edits the
 * whole leg list as one unit (add/remove/reorder), so there's no per-row
 * diffing to get right, just a clean replace inside a transaction.
 */
export async function setComboLegs(comboId: string, legs: ComboLegInput[]) {
  await prisma.$transaction([
    prisma.comboLeg.deleteMany({ where: { comboId } }),
    prisma.comboLeg.createMany({
      data: legs.map((leg, i) => ({
        comboId,
        matchLabel: leg.matchLabel,
        market: leg.market,
        pick: leg.pick,
        odds: 1, // legacy non-null column; no longer displayed or sourced from AI
        predictionId: leg.predictionId ?? null,
        order: i,
      })),
    }),
  ]);
}
