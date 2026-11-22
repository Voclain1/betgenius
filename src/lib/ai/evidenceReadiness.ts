import type { MatchDigest } from "@/lib/ai/digest";
import type { ContextSources } from "@/lib/ai/generationContext";

/**
 * A provider's empty payload, unavailable stats, or an injury-only cache
 * cannot justify a result/total-goals selection. We require at least one
 * corroborated sporting observation, not simply available team names.
 *
 * These facts are already in the digest: no extra API-Football calls.
 * Sparse competitions remain eligible to generate when real results become
 * available. A partial-data fixture can still reach admin review; its other
 * publication/odds gates remain unchanged.
 */
export function hasSubstantiveFootballEvidence(d: MatchDigest): boolean {
  const home = d.teams?.home;
  const away = d.teams?.away;
  return Boolean(
    home?.overall || away?.overall ||
    (home?.last5?.length ?? 0) > 0 || (away?.last5?.length ?? 0) > 0 ||
    (home?.domestic?.played ?? 0) > 0 || (away?.domestic?.played ?? 0) > 0 ||
    (d.h2h?.meetings?.length ?? 0) > 0 ||
    d.standings?.neighbourhood?.some((row) => row.isFixtureTeam && row.played > 0)
  );
}

/** A no-evidence deferral is not an exhausted model/fixture retry. */
export class FootballEvidenceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FootballEvidenceUnavailableError";
  }
}

/** What can be concluded from existing source markers, without guessing that
 * missing data means a provider outage or that empty H2H means no meetings.
 */
export function unavailableEvidenceReason(
  input: { homeId: number | null; awayId: number | null; cacheOnly: boolean },
  sources: ContextSources,
): string {
  const missingIds: string[] = [];
  if (input.homeId == null) missingIds.push("home");
  if (input.awayId == null) missingIds.push("away");
  const sourceStatus = [
    `home=${sources.homeTeam}`, `away=${sources.awayTeam}`,
    `standings=${sources.standings}`, `h2h=${sources.h2h}`,
  ].join(", ");
  return [
    "No usable results or team statistics for generation; deferred before model call.",
    missingIds.length ? `Unresolved team IDs: ${missingIds.join(", ")}.` : "Both team IDs supplied.",
    `Evidence sources: ${sourceStatus}.`,
    input.cacheOnly ? "Cache-only route: no API calls made for missing evidence." : "Cache refresh attempted where eligible; inspect recorded cache lastError and API usage before retrying.",
  ].join(" ");
}
