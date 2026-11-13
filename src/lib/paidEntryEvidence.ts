/**
 * Conservative evidence extraction: a price is an entry observation only if
 * the saved market confirmation carries an explicit pre-kickoff quote timestamp.
 * This does not prove the bookmaker price was executable for every subscriber.
 */
export function verifiedEntryPrice(
  confirmation: unknown,
  kickoff: Date,
): number | null {
  if (!confirmation || typeof confirmation !== "object" || !Number.isFinite(kickoff.getTime())) return null;
  const c = confirmation as Record<string, unknown>;
  const price = c.entryPrice;
  const quoted = typeof c.quoteFetchedAt === "string" ? new Date(c.quoteFetchedAt) : null;
  const confirmed = typeof c.confirmedAt === "string" ? new Date(c.confirmedAt) : null;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 1 ||
    !quoted || !Number.isFinite(quoted.getTime()) ||
    !confirmed || !Number.isFinite(confirmed.getTime()) ||
    quoted.getTime() > confirmed.getTime() ||
    confirmed.getTime() - quoted.getTime() > 6 * 60 * 60 * 1000 ||
    confirmed.getTime() >= kickoff.getTime()) return null;
  return price;
}
