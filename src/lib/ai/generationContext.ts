/**
 * Assemble a MatchDigest for generation, preferring the enrichment caches over
 * live api-football calls.
 *
 * Before this module, every generation cost ~11 metered calls: two team
 * searches, two getTeamContext (three calls each), standings, and head-to-head.
 * Every one of those now has a cached equivalent that a cron already keeps
 * warm, and Phase 3 made the team half byte-identical by having
 * refreshTeamCache store the very same buildTeamDigest projection the prompt
 * uses. So with warm caches this costs ZERO api-football quota.
 *
 * The saving is not the only point. Reading the cache means the model reasons
 * from exactly the numbers the match page will render, rather than from a
 * second fetch taken seconds later that could disagree at a season boundary or
 * mid-refresh.
 *
 * On a miss it does NOT re-implement fetching. It calls the same refresh
 * functions the cron uses and re-reads, which both fills the cache for the next
 * consumer and keeps one code path responsible for how a cache row is written.
 */

import { prisma } from "@/lib/prisma";
import {
  refreshTeamCache,
  refreshLeagueCache,
  refreshH2HCache,
  type LeagueStandingRow,
  type LeaguePlayerStat,
} from "@/lib/enrichment";
import {
  assembleMatchDigest,
  buildStandingsContext,
  buildTeamDigest,
  type MatchDigest,
  type TeamDigest,
  type KeyPlayer,
} from "@/lib/ai/digest";
import type { StandingsEntry } from "@/lib/football/api-football";
import type { H2HMeeting } from "@/lib/h2h";
import { h2hPairKey } from "@/lib/slug";
import { isCupCompetition } from "@/lib/cupConfig";

/**
 * How old a cached team digest may be before generation refreshes it.
 *
 * Twelve hours rather than the enrichment cron's own 3-hourly cadence: this is
 * a floor on acceptable staleness, not a target. The proximity tiers in
 * enrichment.ts are what actually keep an imminent fixture's teams fresh; this
 * only catches the case where a fixture was selected before the cron reached
 * its teams at all.
 */
export const TEAM_DIGEST_MAX_AGE_MS = 12 * 60 * 60_000;

/** Standings move once per matchday, so a longer floor is fine. */
export const STANDINGS_MAX_AGE_MS = 24 * 60 * 60_000;

/** Where each part of the digest came from — surfaced on the run report so cache effectiveness is visible, not assumed. */
export type ContextSources = {
  homeTeam: "cache" | "fetched" | "missing";
  awayTeam: "cache" | "fetched" | "missing";
  standings: "cache" | "fetched" | "missing";
  h2h: "cache" | "fetched" | "missing";
  /** api-football calls this assembly actually spent. Zero on a fully warm path. */
  apiCalls: number;
};

const KEY_PLAYERS_PER_TEAM = 4;

/**
 * Cached standings rows carry the same figures as a live /standings response in
 * a different shape, so they're mapped back rather than given a second
 * implementation of the neighbourhood logic.
 */
function toStandingsEntries(rows: LeagueStandingRow[]): StandingsEntry[] {
  return rows.map((r) => ({
    rank: r.rank,
    team: { id: r.teamId, name: r.teamName },
    points: r.points,
    goalsDiff: r.goalsFor - r.goalsAgainst,
    form: r.form ?? undefined,
    description: r.zone ?? null,
    all: { played: r.played, win: r.win, draw: r.draw, lose: r.loss, goals: { for: r.goalsFor, against: r.goalsAgainst } },
    home: r.home
      ? { played: r.home.played, win: r.home.win, draw: r.home.draw, lose: r.home.loss, goals: { for: r.home.goalsFor, against: r.home.goalsAgainst } }
      : undefined,
    away: r.away
      ? { played: r.away.played, win: r.away.win, draw: r.away.draw, lose: r.away.loss, goals: { for: r.away.goalsFor, against: r.away.goalsAgainst } }
      : undefined,
  }));
}

function keyPlayersFor(teamApiId: number | null, scorers: LeaguePlayerStat[], assists: LeaguePlayerStat[]): KeyPlayer[] {
  if (teamApiId == null) return [];
  const byName = new Map<string, KeyPlayer>();
  for (const s of scorers) {
    if (s.teamId !== teamApiId) continue;
    byName.set(s.name, { name: s.name, goals: s.value });
  }
  for (const a of assists) {
    if (a.teamId !== teamApiId) continue;
    const existing = byName.get(a.name);
    if (existing) existing.assists = a.value;
    else byName.set(a.name, { name: a.name, assists: a.value });
  }
  return [...byName.values()]
    .sort((x, y) => (y.goals ?? 0) - (x.goals ?? 0) || (y.assists ?? 0) - (x.assists ?? 0))
    .slice(0, KEY_PLAYERS_PER_TEAM);
}

/**
 * Read a team's cached digest, refreshing first when it is missing or older
 * than the floor. Returns null only when the refresh itself failed — the caller
 * treats that as a team with no evidence rather than aborting, exactly as the
 * old null-context path did.
 */
async function loadTeamDigest(
  teamApiId: number | null,
  teamName: string,
  leagueApiId: number | null,
  kickoff: Date | null,
  sources: ContextSources,
  side: "homeTeam" | "awayTeam",
): Promise<TeamDigest | null> {
  if (teamApiId == null) {
    sources[side] = "missing";
    return null;
  }

  const row = await prisma.teamEnrichmentCache.findUnique({
    where: { teamApiId },
    select: { teamDigestJson: true, fetchedAt: true },
  });

  const fresh = !!row?.fetchedAt && Date.now() - row.fetchedAt.getTime() < TEAM_DIGEST_MAX_AGE_MS;
  if (fresh && row?.teamDigestJson) {
    sources[side] = "cache";
    return row.teamDigestJson as unknown as TeamDigest;
  }

  // Miss or stale — refresh through the cron's own writer so the row is filled
  // for every later reader too, then read back what it stored.
  const result = await refreshTeamCache({ teamApiId, teamName, leagueApiId, kickoff });
  sources.apiCalls += 4; // getTeamById + getTeamContext's three
  if (result.result !== "ok") {
    sources[side] = "missing";
    return null;
  }

  const refreshed = await prisma.teamEnrichmentCache.findUnique({
    where: { teamApiId },
    select: { teamDigestJson: true },
  });
  sources[side] = refreshed?.teamDigestJson ? "fetched" : "missing";
  return (refreshed?.teamDigestJson as unknown as TeamDigest) ?? null;
}

export type GenerationContextInput = {
  home: string;
  away: string;
  league: string;
  kickoff: string;
  homeApiId: number | null;
  awayApiId: number | null;
  leagueApiId: number | null;
  round?: string | null;
};

/**
 * Build the digest for one fixture, cache-first.
 *
 * Team ids are REQUIRED input rather than resolved here. The scheduled worker
 * takes them straight off the fixture list it already fetched, which removes
 * the two searchTeam calls (and their retry variants) that generation used to
 * spend re-deriving ids it was handed.
 */
export async function buildGenerationDigest(
  input: GenerationContextInput,
): Promise<{ digest: MatchDigest; sources: ContextSources }> {
  const sources: ContextSources = {
    homeTeam: "missing",
    awayTeam: "missing",
    standings: "missing",
    h2h: "missing",
    apiCalls: 0,
  };

  const kickoffDate = new Date(input.kickoff);
  const kickoff = isNaN(kickoffDate.getTime()) ? null : kickoffDate;

  const [homeDigest, awayDigest] = await Promise.all([
    loadTeamDigest(input.homeApiId, input.home, input.leagueApiId, kickoff, sources, "homeTeam"),
    loadTeamDigest(input.awayApiId, input.away, input.leagueApiId, kickoff, sources, "awayTeam"),
  ]);

  // --- Standings -----------------------------------------------------------
  let standingsRows: LeagueStandingRow[] | null = null;
  let leaguePlayers: { scorers: LeaguePlayerStat[]; assists: LeaguePlayerStat[] } = { scorers: [], assists: [] };

  const cupFixture = isCupCompetition(input.leagueApiId);
  if (input.leagueApiId != null && !cupFixture) {
    const leagueRow = await prisma.leagueEnrichmentCache.findUnique({
      where: { leagueApiId: input.leagueApiId },
      select: { standingsJson: true, fetchedAt: true, topScorersJson: true, topAssistsJson: true, playersFetchedAt: true },
    });

    const leagueFresh = !!leagueRow?.fetchedAt && Date.now() - leagueRow.fetchedAt.getTime() < STANDINGS_MAX_AGE_MS;
    if (leagueFresh && leagueRow?.standingsJson) {
      standingsRows = leagueRow.standingsJson as unknown as LeagueStandingRow[];
      sources.standings = "cache";
    } else {
      const result = await refreshLeagueCache({ leagueApiId: input.leagueApiId, kickoff });
      sources.apiCalls += 2;
      if (result.result === "ok") {
        const refreshed = await prisma.leagueEnrichmentCache.findUnique({
          where: { leagueApiId: input.leagueApiId },
          select: { standingsJson: true },
        });
        standingsRows = (refreshed?.standingsJson as unknown as LeagueStandingRow[]) ?? null;
        sources.standings = standingsRows ? "fetched" : "missing";
      }
    }

    // Leaderboards are read-only here and never refreshed on this path: naming
    // a top scorer is worth having, not worth three calls per generation.
    if (leagueRow?.playersFetchedAt) {
      leaguePlayers = {
        scorers: (leagueRow.topScorersJson as unknown as LeaguePlayerStat[] | null) ?? [],
        assists: (leagueRow.topAssistsJson as unknown as LeaguePlayerStat[] | null) ?? [],
      };
    }
  }

  // --- Head to head --------------------------------------------------------
  let meetings: H2HMeeting[] = [];
  const pairKey = h2hPairKey(input.homeApiId, input.awayApiId);
  if (pairKey && input.homeApiId != null && input.awayApiId != null) {
    const cached = await prisma.h2HCache.findUnique({ where: { pairKey }, select: { meetingsJson: true, fetchedAt: true } });
    if (cached?.fetchedAt) {
      meetings = (cached.meetingsJson as unknown as H2HMeeting[] | null) ?? [];
      sources.h2h = "cache";
    } else {
      const result = await refreshH2HCache({
        pairKey,
        teamAApiId: Math.min(input.homeApiId, input.awayApiId),
        teamBApiId: Math.max(input.homeApiId, input.awayApiId),
        latestKickoff: kickoff,
      });
      sources.apiCalls += 1;
      if (result.result === "ok") {
        const refreshed = await prisma.h2HCache.findUnique({ where: { pairKey }, select: { meetingsJson: true } });
        meetings = (refreshed?.meetingsJson as unknown as H2HMeeting[] | null) ?? [];
        sources.h2h = "fetched";
      }
    }
  }

  // --- Assemble ------------------------------------------------------------
  // A team with no cached digest still needs a TeamDigest-shaped entry, so the
  // prompt sees an explicitly empty side rather than a hole. buildTeamDigest
  // with no inputs produces exactly that, and coverage flags stay false.
  const emptyDigest = (name: string, apiId: number | null) => buildTeamDigest({ name, apiId });

  const standingsEntries = standingsRows ? toStandingsEntries(standingsRows) : null;
  const standings = buildStandingsContext(standingsEntries, [input.homeApiId, input.awayApiId]);

  // rank/points are null in a stored team digest (standings are a league-level
  // fetch) — merged here from the same table the neighbourhood came from.
  const withRank = (d: TeamDigest, apiId: number | null): TeamDigest => {
    const row = apiId == null ? null : standingsRows?.find((r) => r.teamId === apiId);
    return row ? { ...d, rank: row.rank, points: row.points } : d;
  };

  const home = withRank(homeDigest ?? emptyDigest(input.home, input.homeApiId), input.homeApiId);
  const away = withRank(awayDigest ?? emptyDigest(input.away, input.awayApiId), input.awayApiId);

  const digest = assembleMatchDigest({
    fixture: {
      home: input.home,
      away: input.away,
      league: input.league,
      kickoff: input.kickoff,
      competitionType: cupFixture ? "CUP" : "LEAGUE",
      round: input.round ?? null,
    },
    homeTeam: { ...home, keyPlayers: keyPlayersFor(input.homeApiId, leaguePlayers.scorers, leaguePlayers.assists) },
    awayTeam: { ...away, keyPlayers: keyPlayersFor(input.awayApiId, leaguePlayers.scorers, leaguePlayers.assists) },
    homeApiId: input.homeApiId,
    awayApiId: input.awayApiId,
    meetings,
    standings,
  });

  return { digest, sources };
}
