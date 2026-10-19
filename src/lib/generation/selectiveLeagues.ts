import { prisma } from "@/lib/prisma";
import type { FixtureRow } from "@/lib/football/api-football";
import type { LeagueStandingRow } from "@/lib/enrichment";

/**
 * Leagues generated every day, but only for their matches worth a tip.
 *
 * In leagues like these a handful of clubs are strong and consistent and the
 * rest are not worth a pick. So a fixture qualifies only when at least one
 * side sits in the league's top `topN` of the current table, with at least
 * `minPlayed` games behind that place so an opening-week table cannot decide
 * it. Everything else in the league is skipped, as before this rule.
 *
 * The table comes from LeagueEnrichmentCache, refreshed here when it is older
 * than STANDINGS_MAX_AGE_MS (one refresh per league a day, a few api-football
 * calls). No usable table means no fixture qualifies: unknown is not "worth it".
 */
export const SELECTIVE_LEAGUES: Readonly<Record<number, { name: string; topN: number; minPlayed: number }>> = {
  318: { name: "Cyprus First Division", topN: 3, minPlayed: 3 },
  365: { name: "Latvia Virsliga", topN: 3, minPlayed: 3 },
};

export const STANDINGS_MAX_AGE_MS = 20 * 3_600_000;
const RETRY_AFTER_FAILURE_MS = 6 * 3_600_000;

export function isSelectiveLeague(leagueApiId: number | null | undefined): boolean {
  return leagueApiId != null && leagueApiId in SELECTIVE_LEAGUES;
}

/** The clubs worth a tip in a selective league: its current top `topN`. Pure. */
export function strongTeamIds(leagueApiId: number, table: readonly LeagueStandingRow[] | null | undefined): Set<number> {
  const rule = SELECTIVE_LEAGUES[leagueApiId];
  if (!rule || !table?.length) return new Set();
  return new Set(table.filter((r) => r.rank <= rule.topN && r.played >= rule.minPlayed).map((r) => r.teamId));
}

/** Does this fixture pass its league's rule? Fixtures outside selective leagues always pass. Pure. */
export function isWorthATip(row: FixtureRow, tables: ReadonlyMap<number, readonly LeagueStandingRow[] | null>): boolean {
  const leagueId = row.league?.id;
  if (!isSelectiveLeague(leagueId)) return true;
  const strong = strongTeamIds(leagueId, tables.get(leagueId));
  return strong.has(row.teams.home.id) || strong.has(row.teams.away.id);
}

/** Current tables for the selective leagues present in `rows`, refreshing stale ones. Never throws. */
export async function loadSelectiveTables(rows: readonly FixtureRow[], now: Date = new Date()): Promise<Map<number, LeagueStandingRow[] | null>> {
  const ids = [...new Set(rows.map((r) => r.league?.id).filter((id): id is number => isSelectiveLeague(id)))];
  const tables = new Map<number, LeagueStandingRow[] | null>();
  for (const leagueApiId of ids) {
    try {
      let row = await prisma.leagueEnrichmentCache.findUnique({ where: { leagueApiId }, select: { standingsJson: true, fetchedAt: true, lastAttemptAt: true } });
      const fresh = row?.fetchedAt && now.getTime() - row.fetchedAt.getTime() < STANDINGS_MAX_AGE_MS && row.standingsJson;
      const triedRecently = row?.lastAttemptAt && now.getTime() - row.lastAttemptAt.getTime() < RETRY_AFTER_FAILURE_MS;
      if (!fresh && !triedRecently) {
        // Dynamic: enrichment is a large module the selector otherwise never loads.
        const { refreshLeagueCache } = await import("@/lib/enrichment");
        const kickoff = rows.find((r) => r.league?.id === leagueApiId)?.fixture.date;
        await refreshLeagueCache({ leagueApiId, kickoff: kickoff ? new Date(kickoff) : now });
        row = await prisma.leagueEnrichmentCache.findUnique({ where: { leagueApiId }, select: { standingsJson: true, fetchedAt: true, lastAttemptAt: true } });
      }
      tables.set(leagueApiId, (row?.standingsJson as unknown as LeagueStandingRow[] | null) ?? null);
    } catch (err) {
      console.error(`[selective-leagues] no table for league ${leagueApiId}; its fixtures are skipped`, err);
      tables.set(leagueApiId, null);
    }
  }
  return tables;
}
