import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";

/**
 * Does a hand-entered match belong to the competition it was filed under?
 *
 * League pages list every prediction stored under the league's provider id, so
 * a match filed under the wrong competition simply appears on that
 * competition's page. This happened on 17 Nov 2026: two Ecuador v Bolivia
 * picks entered through the admin form kept its pre-selected first league,
 * Premier League (39), and showed on the England Premier League page.
 *
 * The teams that really play in a competition are the ones the provider's
 * fixture discovery recorded for it (GenerationAttempt). A match with a
 * provider fixture id came from that same feed and is trusted; only hand-typed
 * ones are checked. With no discovery history for the competition there is
 * nothing to judge against, so the check stays silent rather than guess.
 *
 * Names are compared loosely (slug equal, one contained in the other, or a
 * shared word of 4+ letters) because an admin types "Man Utd" and the feed says
 * "Manchester United". A false alarm only costs a confirmation click.
 */
export const LEAGUE_TEAM_MISMATCH = "LEAGUE_TEAM_MISMATCH";

const LOOKBACK_MS = 400 * 24 * 3_600_000;

const words = (slug: string) => slug.split("-").filter((w) => w.length >= 4);

function sameTeam(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  const wb = new Set(words(b));
  return words(a).some((w) => wb.has(w));
}

/** Pure: is at least one of the two teams a known team of the competition? */
export function teamsMatchKnown(known: Iterable<string>, home: string | null | undefined, away: string | null | undefined): boolean {
  const slugs = [...new Set([...known].map((n) => slugify(n)).filter(Boolean))];
  if (slugs.length === 0) return true; // no history to judge against
  const sides = [home, away].filter((t): t is string => !!t && !!t.trim()).map((t) => slugify(t));
  if (sides.length === 0) return true;
  return sides.some((side) => slugs.some((k) => sameTeam(side, k)));
}

/** A message when neither team is known in the league, else null. */
export async function leagueTeamMismatch(input: {
  leagueApiId?: number | null;
  leagueName?: string | null;
  home?: string | null;
  away?: string | null;
  fixtureApiId?: number | null;
}): Promise<string | null> {
  if (input.leagueApiId == null || input.fixtureApiId != null) return null;
  const rows = await prisma.generationAttempt.findMany({
    where: { leagueApiId: input.leagueApiId, kickoff: { gte: new Date(Date.now() - LOOKBACK_MS) } },
    select: { homeTeam: true, awayTeam: true },
    take: 4000,
  });
  const known = rows.flatMap((r) => [r.homeTeam, r.awayTeam]);
  if (teamsMatchKnown(known, input.home, input.away)) return null;
  const league = input.leagueName?.trim() || `league ${input.leagueApiId}`;
  return `Neither ${input.home || "the home team"} nor ${input.away || "the away team"} has played in ${league} (the fixture feed has no such match there). It would be listed on the ${league} page. Check the competition, or choose Other.`;
}
