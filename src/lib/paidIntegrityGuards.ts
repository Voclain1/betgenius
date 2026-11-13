/**
 * Conservative paid-feed integrity guards.
 * Pure and independent of the ranking model. Never silently drops picks:
 * returns accepted selections and explicit rejection reasons.
 */
export type PaidCandidate = {
  id: string;
  fixtureId: string;
  kickoff: Date;
  market: string;
  selection: string;
  price: number | null;
  quotedAt: Date | null;
  confidence: number | null;
};
export type RejectionReason =
  | "DUPLICATE_ID" | "DUPLICATE_MARKET" | "CONTRADICTORY_MARKET"
  | "INVALID_KICKOFF" | "KICKOFF_TOO_SOON" | "STALE_OR_FUTURE_QUOTE"
  | "INVALID_PRICE" | "INVALID_CONFIDENCE";
export type GuardResult = { accepted: PaidCandidate[]; rejected: Array<{ id: string; reason: RejectionReason }> };

export function guardPaidCandidates(
  candidates: readonly PaidCandidate[],
  now: Date,
  options: { minLeadMinutes?: number; maxQuoteAgeMinutes?: number } = {},
): GuardResult {
  const lead = (options.minLeadMinutes ?? 15) * 60_000;
  const age = (options.maxQuoteAgeMinutes ?? 360) * 60_000;
  if (!(lead >= 0 && age > 0)) throw new RangeError("Invalid time thresholds");
  const accepted: PaidCandidate[] = [];
  const rejected: GuardResult["rejected"] = [];
  const ids = new Set<string>();
  const markets = new Map<string, string>();
  for (const candidate of candidates) {
    let reason: RejectionReason | null = null;
    const fixture = candidate.fixtureId.trim();
    const market = candidate.market.trim().toUpperCase();
    const selection = candidate.selection.trim().toUpperCase();
    const key = `${fixture}: ${market}`;
    if (ids.has(candidate.id)) reason = "DUPLICATE_ID";
    else if (!candidate.kickoff || !Number.isFinite(candidate.kickoff.getTime())) reason = "INVALID_KICKOFF";
    else if (candidate.kickoff.getTime() - now.getTime() < lead) reason = "KICKOFF_TOO_SOON";
    else if (!candidate.quotedAt || !Number.isFinite(candidate.quotedAt.getTime()) ||
      candidate.quotedAt.getTime() > now.getTime() || candidate.quotedAt.getTime() >= candidate.kickoff.getTime() ||
      now.getTime() - candidate.quotedAt.getTime() > age) reason = "STALE_OR_FUTURE_QUOTE";
    else if (candidate.price === null || !Number.isFinite(candidate.price) || candidate.price <= 1) reason = "INVALID_PRICE";
    else if (candidate.confidence === null || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 100) reason = "INVALID_CONFIDENCE";
    else if (markets.has(key)) reason = markets.get(key) === selection ? "DUPLICATE_MARKET" : "CONTRADICTORY_MARKET";
    if (reason) {
      rejected.push({ id: candidate.id, reason });
      continue;
    }
    accepted.push(candidate);
    ids.add(candidate.id);
    markets.set(key, selection);
  }
  return { accepted, rejected };
}
