import { prisma } from "@/lib/prisma";
import type { FixtureRow } from "@/lib/football/api-football";
import type { LeagueStandingRow } from "@/lib/enrichment";
import { generationTierOf, LEAGUE_CATALOGUE, isSeniorWomensCompetition } from "@/lib/leagues";

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
export type SelectiveLeagueRule = { name: string; topN: number; minPlayed: number };
/**
 * Tier labels are NOT permission to generate every match. These explicit
 * secondary markets are selectively discovered even on healthy global days,
 * but only strong-club fixtures pass into inference. Never hardcode club IDs:
 * use the current provider standings to survive promotion/relegation.
 */
export const SELECTIVE_LEAGUES: Readonly<Record<number, SelectiveLeagueRule>> = {
  318: { name: "Cyprus First Division", topN: 3, minPlayed: 3 },
  365: { name: "Latvia Virsliga", topN: 3, minPlayed: 3 },
  307: { name: "Saudi Pro League", topN: 4, minPlayed: 5 },
  301: { name: "UAE Pro League", topN: 3, minPlayed: 5 },
  330: { name: "Kuwaiti Premier League", topN: 3, minPlayed: 5 },
  288: { name: "South Africa PSL", topN: 4, minPlayed: 5 },
  286: { name: "Serbian Super Liga", topN: 4, minPlayed: 5 },
  333: { name: "Ukrainian Premier League", topN: 4, minPlayed: 5 },
  235: { name: "Russian Premier League", topN: 4, minPlayed: 5 },
};

/**
 * Full-fixture analysis coverage across major domestic competitions. EPL and
 * La Liga are examples, never the boundary. This explicit exemption protects
 * major competitions even if a schedule temporarily places them in FALLBACK.
 *
 * These leagues still need actual fixture evidence, confidence and bookmaker
 * quotes before any prediction can be published. 'Eligible' != 'published'.
 * Regional selectivity requested for Saudi/UAE/Kuwait/etc is separate.
 */
export const FULL_FIXTURE_DOMESTIC_LEAGUE_IDS: readonly number[] = [
  39, 140, 135, 78, 61, // European top five
  88, 94, 144, 203, // Netherlands, Portugal, Belgium, Turkey
  207, 218, 179, // Switzerland, Austria, Scotland
  119, 103, 113, 106, 197, 345, // Denmark, Norway, Sweden, Poland, Greece, Czechia
  71, 399, // Brazil Serie A and Nigeria NPFL
  128, 239, 262, 253, // Argentina, Colombia, Mexico, MLS
  98, 292, 233, // Japan J1, Korea K1, Egypt Premier League
];
const FULL_FIXTURE_DOMESTIC_SET = new Set<number>(FULL_FIXTURE_DOMESTIC_LEAGUE_IDS);

/**
 * Only explicitly selected secondary/regional leagues, or genuinely lower/
 * minor competitions in fallback tiers, receive strong-club filtering.
 * Major world leagues in FALLBACK are never treated as minor solely because
 * their tier is used for provider-call scheduling. Cups and women's leagues
 * retain their own rules.
 */
export function selectiveLeagueRule(leagueApiId: number | null | undefined): SelectiveLeagueRule | null {
  if (leagueApiId == null) return null;
  if (FULL_FIXTURE_DOMESTIC_SET.has(leagueApiId)) return null;
  if (SELECTIVE_LEAGUES[leagueApiId]) return SELECTIVE_LEAGUES[leagueApiId];
  const tier = generationTierOf(leagueApiId);
  if (tier !== "FALLBACK" && tier !== "DEEP_FALLBACK") return null;
  const league = LEAGUE_CATALOGUE.find(l => l.id === leagueApiId);
  if (!league || league.kind !== "league" ||
      isSeniorWomensCompetition(leagueApiId) ||
      (league.tier !== "lower" && league.tier !== "minor")) return null;
  return { name: league.name, topN: 4, minPlayed: 5 };
}

export const STANDINGS_MAX_AGE_MS = 20 * 3_600_000;
const RETRY_AFTER_FAILURE_MS = 6 * 3_600_000;

export function isSelectiveLeague(leagueApiId: number | null | undefined): boolean {
  return selectiveLeagueRule(leagueApiId) !== null;
}

/** The clubs worth a tip in a selective league: its current top `topN`. Pure. */
export function strongTeamIds(leagueApiId: number, table: readonly LeagueStandingRow[] | null | undefined): Set<number> {
  const rule = selectiveLeagueRule(leagueApiId);
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
      // An old snapshot is not "current standings" if refresh failed.
      const usable = Boolean(row?.fetchedAt && row.standingsJson &&
        row.fetchedAt.getTime() <= now.getTime() &&
        now.getTime() - row.fetchedAt.getTime() <= 48 * 3_600_000);
      tables.set(leagueApiId, usable ? (row!.standingsJson as unknown as LeagueStandingRow[]) : null);
    } catch (err) {
      console.error(`[selective-leagues] no table for league ${leagueApiId}; its fixtures are skipped`, err);
      tables.set(leagueApiId, null);
    }
  }
  return tables;
}

/**
 * Revalidate already-queued attempts too: fixtures may have entered the ledger
 * before these selective rules were enabled. Both normal and early FREE
 * generators share selectQueuedCandidates, so the queue cannot bypass the
 * strong-team gate even when no new discovery runs.
 */
export async function filterSelectiveQueuedCandidates<T extends {
  leagueApiId: number; homeTeamApiId: number; awayTeamApiId: number; kickoff: Date;
}>(candidates: readonly T[], now: Date): Promise<T[]> {
  const narrowed = candidates.filter(c => isSelectiveLeague(c.leagueApiId));
  if (!narrowed.length) return [...candidates];
  const asRow = (c: T): FixtureRow => ({
    fixture: { date: c.kickoff.toISOString() },
    league: { id: c.leagueApiId },
    teams: { home: { id: c.homeTeamApiId }, away: { id: c.awayTeamApiId } },
  } as FixtureRow);
  const tables = await loadSelectiveTables(narrowed.map(asRow), now);
  return candidates.filter(c => !isSelectiveLeague(c.leagueApiId) ||
    isWorthATip(asRow(c), tables));
}
