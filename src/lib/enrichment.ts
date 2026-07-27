// Team/league enrichment cache — refreshed on a cron (see
// src/app/api/admin/refresh-enrichment/route.ts), read-only from pages (see
// getTeamEnrichment/getLeagueEnrichment in src/lib/predictionScope.ts). Pages
// never call the football API live; this module is the only writer.
//
// Scope is deliberately narrow: only teams/leagues referenced by real
// PUBLISHED predictions, not the whole football universe — mirrors the
// full-scan-then-dedupe-in-JS posture predictionScope.ts already uses at this
// data volume (see its file comment) rather than adding new indexes.
import { prisma } from "@/lib/prisma";
import { getTeamById, getTeamContext, getStandings, getFixturesByLeague, resolveSeason, type FixtureRow, type StandingsEntry } from "@/lib/football/api-football";

export type TeamTarget = { teamApiId: number; teamName: string | null; leagueApiId: number | null; kickoff: Date | null };
export type LeagueTarget = { leagueApiId: number; kickoff: Date | null };

// Shapes stored in TeamEnrichmentCache/LeagueEnrichmentCache's Json columns —
// shared with the read side (TeamEnrichmentPanel/LeagueEnrichmentPanel) so
// both sides agree on what's actually in the cache without re-deriving it.
export type TeamStatsSummary = { played: number | null; win: number | null; draw: number | null; loss: number | null; goalsFor: number | null; goalsAgainst: number | null };
export type TeamFixtureSummary = { opponent: string; result: string; date: string; venue: "home" | "away" };
export type LeagueStandingRow = { rank: number; teamId: number; teamName: string; teamLogo: string | null; points: number; played: number; win: number; draw: number; loss: number; goalsFor: number; goalsAgainst: number; form: string | null };
export type LeagueUpcomingFixture = { id: number; date: string; homeTeam: string; awayTeam: string; homeLogo: string | null; awayLogo: string | null };

/** Distinct team ids referenced by PUBLISHED predictions, each paired with the most recent row's league/kickoff (for season resolution). */
export async function getScopedTeamTargets(): Promise<TeamTarget[]> {
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", OR: [{ homeTeamApiId: { not: null } }, { awayTeamApiId: { not: null } }] },
    select: { homeTeamApiId: true, awayTeamApiId: true, homeTeam: true, awayTeam: true, leagueApiId: true, kickoff: true },
    orderBy: { publishedAt: "desc" },
  });
  const byId = new Map<number, TeamTarget>();
  for (const r of rows) {
    if (r.homeTeamApiId != null && !byId.has(r.homeTeamApiId)) {
      byId.set(r.homeTeamApiId, { teamApiId: r.homeTeamApiId, teamName: r.homeTeam, leagueApiId: r.leagueApiId, kickoff: r.kickoff });
    }
    if (r.awayTeamApiId != null && !byId.has(r.awayTeamApiId)) {
      byId.set(r.awayTeamApiId, { teamApiId: r.awayTeamApiId, teamName: r.awayTeam, leagueApiId: r.leagueApiId, kickoff: r.kickoff });
    }
  }
  return [...byId.values()];
}

/** Distinct league ids referenced by PUBLISHED predictions, each paired with the most recent row's kickoff (for season resolution). */
export async function getScopedLeagueTargets(): Promise<LeagueTarget[]> {
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", leagueApiId: { not: null } },
    select: { leagueApiId: true, kickoff: true },
    orderBy: { publishedAt: "desc" },
  });
  const byId = new Map<number, LeagueTarget>();
  for (const r of rows) {
    if (!byId.has(r.leagueApiId!)) byId.set(r.leagueApiId!, { leagueApiId: r.leagueApiId!, kickoff: r.kickoff });
  }
  return [...byId.values()];
}

function trimStatistics(statistics: any): TeamStatsSummary | null {
  if (!statistics) return null;
  return {
    played: statistics.fixtures?.played?.total ?? null,
    win: statistics.fixtures?.wins?.total ?? null,
    draw: statistics.fixtures?.draws?.total ?? null,
    loss: statistics.fixtures?.loses?.total ?? null,
    goalsFor: statistics.goals?.for?.total?.total ?? null,
    goalsAgainst: statistics.goals?.against?.total?.total ?? null,
  };
}

function trimLastFixtures(teamApiId: number, fixtures: FixtureRow[] | null): TeamFixtureSummary[] | null {
  if (!fixtures?.length) return null;
  return fixtures.map((f) => {
    const isHome = f.teams.home.id === teamApiId;
    const own = isHome ? f.goals.home : f.goals.away;
    const opp = isHome ? f.goals.away : f.goals.home;
    const result = own == null || opp == null ? "?" : own > opp ? "W" : own < opp ? "L" : "D";
    return { opponent: isHome ? f.teams.away.name : f.teams.home.name, result, date: f.fixture.date, venue: isHome ? "home" : "away" };
  });
}

/**
 * Refresh one team's cache row. On any usable data, sets fetchedAt + the data
 * columns. On nothing usable (incl. today's expected free-plan rejection),
 * only lastAttemptAt/lastError are written — fetchedAt and prior data columns
 * are left untouched so a transient failure can't blank out a previously-good
 * cache entry.
 */
export async function refreshTeamCache(target: TeamTarget): Promise<{ teamApiId: number; result: "ok" | "failed" | "error"; detail?: string }> {
  const now = new Date();
  try {
    const season = target.leagueApiId ? await resolveSeason(target.leagueApiId, target.kickoff ?? new Date()) : new Date().getFullYear();

    const [teamInfo, context] = await Promise.all([
      getTeamById(target.teamApiId),
      target.leagueApiId ? getTeamContext(target.teamApiId, target.leagueApiId, season) : Promise.resolve(null),
    ]);

    const form = typeof context?.statistics === "object" && context.statistics ? ((context.statistics as any).form ?? null) : null;
    const statsJson = trimStatistics(context?.statistics);
    const lastFixtures = trimLastFixtures(target.teamApiId, context?.lastFixtures ?? null);
    const succeeded = !!teamInfo || !!statsJson || !!lastFixtures || !!form;

    if (!succeeded) {
      await prisma.teamEnrichmentCache.upsert({
        where: { teamApiId: target.teamApiId },
        create: { teamApiId: target.teamApiId, teamName: target.teamName, leagueApiId: target.leagueApiId, lastAttemptAt: now, lastError: "No data returned — see server logs for the underlying api-football error" },
        update: { lastAttemptAt: now, lastError: "No data returned — see server logs for the underlying api-football error" },
      });
      return { teamApiId: target.teamApiId, result: "failed" };
    }

    await prisma.teamEnrichmentCache.upsert({
      where: { teamApiId: target.teamApiId },
      create: {
        teamApiId: target.teamApiId, teamName: target.teamName, leagueApiId: target.leagueApiId, season,
        crestUrl: teamInfo?.logo ?? null, form, statsJson: statsJson ?? undefined, lastFixtures: lastFixtures ?? undefined,
        fetchedAt: now, lastAttemptAt: now, lastError: null,
      },
      update: {
        teamName: target.teamName, leagueApiId: target.leagueApiId, season,
        crestUrl: teamInfo?.logo ?? null, form, statsJson: statsJson ?? undefined, lastFixtures: lastFixtures ?? undefined,
        fetchedAt: now, lastAttemptAt: now, lastError: null,
      },
    });
    return { teamApiId: target.teamApiId, result: "ok" };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await prisma.teamEnrichmentCache
      .upsert({
        where: { teamApiId: target.teamApiId },
        create: { teamApiId: target.teamApiId, teamName: target.teamName, leagueApiId: target.leagueApiId, lastAttemptAt: now, lastError: message },
        update: { lastAttemptAt: now, lastError: message },
      })
      .catch(() => {});
    return { teamApiId: target.teamApiId, result: "error", detail: message };
  }
}

function trimStandings(standings: StandingsEntry[] | null): LeagueStandingRow[] | null {
  if (!standings?.length) return null;
  return standings.map((s) => ({
    rank: s.rank,
    teamId: s.team.id,
    teamName: s.team.name,
    teamLogo: s.team.logo ?? null,
    points: s.points,
    played: s.all.played,
    win: s.all.win,
    draw: s.all.draw,
    loss: s.all.lose,
    goalsFor: s.all.goals.for,
    goalsAgainst: s.all.goals.against,
    form: s.form ?? null,
  }));
}

function trimUpcoming(fixtures: FixtureRow[] | null): LeagueUpcomingFixture[] | null {
  if (!fixtures?.length) return null;
  return fixtures
    .filter((f) => f.fixture.status.short === "NS")
    .slice(0, 8)
    .map((f) => ({
      id: f.fixture.id,
      date: f.fixture.date,
      homeTeam: f.teams.home.name,
      awayTeam: f.teams.away.name,
      homeLogo: f.teams.home.logo ?? null,
      awayLogo: f.teams.away.logo ?? null,
    }));
}

/** Same shape/invariants as refreshTeamCache — see its comment. */
export async function refreshLeagueCache(target: LeagueTarget): Promise<{ leagueApiId: number; result: "ok" | "failed" | "error"; detail?: string }> {
  const now = new Date();
  try {
    const season = await resolveSeason(target.leagueApiId, target.kickoff ?? new Date());
    const today = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [standingsRaw, fixturesRaw] = await Promise.all([
      getStandings(target.leagueApiId, season),
      getFixturesByLeague(target.leagueApiId, season, today, to),
    ]);

    const standingsJson = trimStandings(standingsRaw);
    const upcomingJson = trimUpcoming(fixturesRaw);
    const succeeded = !!standingsJson || !!upcomingJson;

    if (!succeeded) {
      await prisma.leagueEnrichmentCache.upsert({
        where: { leagueApiId: target.leagueApiId },
        create: { leagueApiId: target.leagueApiId, lastAttemptAt: now, lastError: "No data returned — see server logs for the underlying api-football error" },
        update: { lastAttemptAt: now, lastError: "No data returned — see server logs for the underlying api-football error" },
      });
      return { leagueApiId: target.leagueApiId, result: "failed" };
    }

    await prisma.leagueEnrichmentCache.upsert({
      where: { leagueApiId: target.leagueApiId },
      create: { leagueApiId: target.leagueApiId, season, standingsJson: standingsJson ?? undefined, upcomingJson: upcomingJson ?? undefined, fetchedAt: now, lastAttemptAt: now, lastError: null },
      update: { season, standingsJson: standingsJson ?? undefined, upcomingJson: upcomingJson ?? undefined, fetchedAt: now, lastAttemptAt: now, lastError: null },
    });
    return { leagueApiId: target.leagueApiId, result: "ok" };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await prisma.leagueEnrichmentCache
      .upsert({
        where: { leagueApiId: target.leagueApiId },
        create: { leagueApiId: target.leagueApiId, lastAttemptAt: now, lastError: message },
        update: { lastAttemptAt: now, lastError: message },
      })
      .catch(() => {});
    return { leagueApiId: target.leagueApiId, result: "error", detail: message };
  }
}

/** Orders scoped targets so never-attempted ids come first, then the stalest lastAttemptAt — round-robins across cycles if the scoped set ever exceeds one run's slice. */
export async function orderTeamsByStaleness(targets: TeamTarget[]): Promise<TeamTarget[]> {
  const existing = await prisma.teamEnrichmentCache.findMany({
    where: { teamApiId: { in: targets.map((t) => t.teamApiId) } },
    select: { teamApiId: true, lastAttemptAt: true },
  });
  const attemptMap = new Map(existing.map((r) => [r.teamApiId, r.lastAttemptAt?.getTime() ?? -Infinity]));
  return [...targets].sort((a, b) => (attemptMap.get(a.teamApiId) ?? -Infinity) - (attemptMap.get(b.teamApiId) ?? -Infinity));
}

export async function orderLeaguesByStaleness(targets: LeagueTarget[]): Promise<LeagueTarget[]> {
  const existing = await prisma.leagueEnrichmentCache.findMany({
    where: { leagueApiId: { in: targets.map((t) => t.leagueApiId) } },
    select: { leagueApiId: true, lastAttemptAt: true },
  });
  const attemptMap = new Map(existing.map((r) => [r.leagueApiId, r.lastAttemptAt?.getTime() ?? -Infinity]));
  return [...targets].sort((a, b) => (attemptMap.get(a.leagueApiId) ?? -Infinity) - (attemptMap.get(b.leagueApiId) ?? -Infinity));
}
