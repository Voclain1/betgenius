import { prisma } from "@/lib/prisma";

export type ComboLegInput = {
  matchLabel: string;
  market: string;
  pick: string;
  predictionId?: string | null;
  /**
   * The real bookmaker price this leg was assembled at, for odds-tier
   * accumulators. Omitted by the admin combo builder, which has no price to
   * state — see the note on the write below.
   */
  odds?: number | null;
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
        // Was a legacy non-null column carrying a placeholder 1, because the
        // AI never had a price to put in it and nothing displayed it. Odds-tier
        // accumulators DO have one — a real, quoted, multi-bookmaker price read
        // from FixtureOddsCache at assembly time — so the column now stores it.
        //
        // Storing it rather than re-reading the cache at render time is
        // deliberate: prices move, and the combined multiple shown on the card
        // has to be the one these legs were actually chosen to hit. A card that
        // recomputed itself would drift away from its own tier between the
        // assembly and the kickoff.
        //
        // Hand-built Multi Bets still pass nothing and still store 1, which is
        // why nothing displays a price unless oddsTier says the combo is a
        // curated accumulator.
        odds: leg.odds ?? 1,
        predictionId: leg.predictionId ?? null,
        order: i,
      })),
    }),
  ]);
}
