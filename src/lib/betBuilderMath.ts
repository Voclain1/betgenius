export type PricedBetLeg = { odds: number | null };

export type SlipCalculation = {
  combinedOdds: number;
  potentialReturn: number;
};

export function calculateSlip(legs: PricedBetLeg[], stake: number): SlipCalculation | null {
  if (
    legs.length === 0 ||
    !Number.isFinite(stake) ||
    stake <= 0 ||
    legs.some((leg) => leg.odds === null || !Number.isFinite(leg.odds) || leg.odds <= 1)
  ) return null;

  const combinedOdds = legs.reduce((total, leg) => total * (leg.odds as number), 1);
  return { combinedOdds, potentialReturn: combinedOdds * stake };
}
