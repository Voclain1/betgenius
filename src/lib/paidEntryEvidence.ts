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

/**
 * Quote metadata is useful for retrospective price coverage, but never
 * establishes an actual subscriber fill. Reject derived prices, missing
 * bookmaker attribution, malformed timestamps and post-kickoff evidence.
 */
export function auditPaidQuoteEvidence(confirmation: unknown, kickoff: Date) {
  const c = confirmation && typeof confirmation === "object" ? confirmation as Record<string, unknown> : null;
  if (!c) return { usable: false, reason: "MISSING_CONFIRMATION" as const };
  if (c.entryPriceBasis !== "BOOKMAKER_MEDIAN_INDICATIVE")
    return { usable: false, reason: "NO_DIRECT_BOOKMAKER_QUOTE" as const };
  const price = verifiedEntryPrice(c, kickoff);
  if (price === null) return { usable: false, reason: "INVALID_PRICE_OR_TIMESTAMPS" as const };
  const market = c.entryQuoteSelection;
  if (!market || typeof market !== "object" ||
      typeof (market as Record<string, unknown>).market !== "string" ||
      typeof (market as Record<string, unknown>).value !== "string")
    return { usable: false, reason: "MISSING_SELECTION" as const };
  const count = c.entryBookmakers;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1)
    return { usable: false, reason: "MISSING_BOOKMAKER_COUNT" as const };
  const sources = c.entryQuoteSources;
  if (!Array.isArray(sources) || sources.length === 0 ||
      !sources.some(q => q && typeof q.bookmaker === "string" && q.bookmaker.trim() &&
        typeof q.odd === "number" && Number.isFinite(q.odd) && q.odd > 1))
    return { usable: false, reason: "MISSING_NAMED_BOOKMAKER" as const };
  return { usable: true, reason: "INDICATIVE_BOOKMAKER_MEDIAN" as const, price };
}

/** Append-only publication evidence. Existing evidence is never replaced. */
export function appendPublicationQuoteEvidence(
  confirmation: unknown,
  publicationEvidence: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation)) return null;
  const original = confirmation as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(original, "publicationQuoteEvidence")) return null;
  return { ...original, publicationQuoteEvidence: { ...publicationEvidence } };
}
