import { prisma } from "@/lib/prisma";

export type ComboLegInput = {
  matchLabel: string;
  market: string;
  pick: string;
  odds: number;
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
        odds: leg.odds,
        predictionId: leg.predictionId ?? null,
        order: i,
      })),
    }),
  ]);
}

export function combinedOdds(legs: { odds: number }[]) {
  return legs.reduce((a, l) => a * l.odds, 1);
}
