import { prisma } from "@/lib/prisma";

export type ComboLegInput = {
  matchLabel: string;
  market: string;
  pick: string;
  predictionId?: string | null;
};

/** A published combo stays browseable until its final linked leg kicks off. */
export function comboIsUpcoming(kickoffs: readonly (Date | string | null)[], now: Date = new Date()): boolean {
  const valid = kickoffs
    .filter((value): value is Date | string => value != null)
    .map((value) => typeof value === "string" ? new Date(value) : value)
    .filter((value) => !Number.isNaN(value.getTime()));
  // Manual-only/legacy combos have no resolvable kickoff; preserve their
  // existing visibility rather than hiding them on missing data.
  if (valid.length === 0) return true;
  return Math.max(...valid.map((value) => value.getTime())) > now.getTime();
}

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
