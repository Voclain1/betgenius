import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { computeStat, type WinRateStat } from "@/lib/trackRecord";
import { leagueSlug, teamSlug, matchSlug, matchKey, h2hSlug, h2hPairKey } from "@/lib/slug";
import { computeH2HStats, type H2HMeeting, type H2HStats } from "@/lib/h2h";
import { getLeagueVisual, leagueLogoUrl, isMajorLeague, MAJOR_LEAGUES } from "@/lib/leagues";

// Backs /predictions/league/[slug] and /predictions/team/[slug]. Prediction
// has no leagueName/homeTeam/awayTeam index and no slug column (see
// src/lib/slug.ts) — with today's row counts a full scan of PUBLISHED rows
// filtered in JS is the same posture trackRecord.ts already uses. Revisit
// (add an index, or persist a slug column) if published volume grows enough
// to make this scan expensive.

const SCOPED_SELECT = {
  id: true,
  category: true,
  categories: { select: { category: true } },
  leagueApiId: true,
  leagueName: true,
  homeTeam: true,
  awayTeam: true,
  homeTeamApiId: true,
  awayTeamApiId: true,
  kickoff: true,
  market: true,
  pick: true,
  overUnder: true,
  odds: true,
  confidence: true,
  reasoning: true,
  matchPreview: true,
  outcome: true,
  publishedAt: true,
} as const;

export type ScopedResult = {
  rows: {
    id: string;
    category: string;
    leagueApiId: number | null;
    leagueName: string | null;
    homeTeam: string | null;
    awayTeam: string | null;
    homeTeamApiId: number | null;
    awayTeamApiId: number | null;
    kickoff: Date | null;
    market: string;
    pick: string;
    overUnder: string | null;
    odds: number | null;
    confidence: number;
    reasoning: string;
    matchPreview: string | null;
    outcome: string;
    publishedAt: Date | null;
  }[];
  stat: WinRateStat;
};

/** All published predictions whose leagueSlug(leagueName, leagueApiId) matches `slug`, most recent first. */
export const getPublishedByLeagueSlug = cache(async (slug: string): Promise<ScopedResult> => {
  const candidates = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", leagueName: { not: null } },
    orderBy: { publishedAt: "desc" },
    select: SCOPED_SELECT,
  });
  const rows = candidates.filter((r) => leagueSlug(r.leagueName!, r.leagueApiId) === slug);
  return { rows, stat: computeStat(rows.filter((r) => r.outcome !== "PENDING").map((r) => r.outcome)) };
});

/** All published predictions where homeTeam or awayTeam slugs to `slug`, most recent first. */
export const getPublishedByTeamSlug = cache(async (slug: string): Promise<ScopedResult> => {
  const candidates = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", OR: [{ homeTeam: { not: null } }, { awayTeam: { not: null } }] },
    orderBy: { publishedAt: "desc" },
    select: SCOPED_SELECT,
  });
  const rows = candidates.filter(
    (r) => (r.homeTeam && teamSlug(r.homeTeam) === slug) || (r.awayTeam && teamSlug(r.awayTeam) === slug),
  );
  return { rows, stat: computeStat(rows.filter((r) => r.outcome !== "PENDING").map((r) => r.outcome)) };
});

export type MatchScopedResult = ScopedResult & {
  /** Fixture identity shared by every row, resolved from the first row that carries it. Null only when the slug matched nothing. */
  match: {
    homeTeam: string;
    awayTeam: string;
    homeTeamApiId: number | null;
    awayTeamApiId: number | null;
    kickoff: Date;
    leagueName: string | null;
    leagueApiId: number | null;
    matchKey: string | null;
  } | null;
};

/**
 * Every PUBLISHED prediction for one fixture, across all markets — the data
 * behind /predictions/match/[slug].
 *
 * Aggregation is by matchKey (both team ids + the kickoff's UTC day, see
 * src/lib/slug.ts); the slug is its readable projection and is what the route
 * carries. Rows are matched on the slug the same way the league/team scopes
 * match theirs — computed per row, never parsed — then ordered by confidence
 * so the strongest pick for the match leads.
 *
 * `kickoff` on the returned match is the EARLIEST across the rows. Rows for
 * one fixture can disagree on the exact timestamp while agreeing on the day
 * (which is why matchKey is day-grained); picking the earliest makes the
 * header deterministic regardless of row order rather than letting whichever
 * row sorted first decide.
 */
export const getPublishedByMatchSlug = cache(async (slug: string): Promise<MatchScopedResult> => {
  const candidates = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", homeTeam: { not: null }, awayTeam: { not: null }, kickoff: { not: null } },
    orderBy: { publishedAt: "desc" },
    select: SCOPED_SELECT,
  });
  const rows = candidates
    .filter((r) => matchSlug(r) === slug)
    .sort((a, b) => b.confidence - a.confidence);

  if (rows.length === 0) return { rows, stat: computeStat([]), match: null };

  const withIds = rows.find((r) => r.homeTeamApiId != null && r.awayTeamApiId != null) ?? rows[0];
  const kickoff = rows.reduce((earliest, r) => (r.kickoff! < earliest ? r.kickoff! : earliest), rows[0].kickoff!);

  return {
    rows,
    stat: computeStat(rows.filter((r) => r.outcome !== "PENDING").map((r) => r.outcome)),
    match: {
      homeTeam: rows[0].homeTeam!,
      awayTeam: rows[0].awayTeam!,
      homeTeamApiId: withIds.homeTeamApiId,
      awayTeamApiId: withIds.awayTeamApiId,
      kickoff,
      leagueName: rows.find((r) => r.leagueName)?.leagueName ?? null,
      leagueApiId: rows.find((r) => r.leagueApiId != null)?.leagueApiId ?? null,
      matchKey: matchKey({ ...withIds, kickoff }),
    },
  };
});

/**
 * Every fixture that has at least one PUBLISHED prediction, as a
 * matchKey → slug lookup. Callers rendering fixtures from the football API
 * (Recent results, Livescores, Fixtures) use it to link only the matches that
 * actually have a page, leaving the rest as plain text — a link to an empty
 * match page is worse than no link.
 *
 * A plain object rather than a Map because it's handed from server components
 * to the client ones that render those feeds.
 */
export const getPublishedMatchIndex = cache(async (): Promise<Record<string, string>> => {
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", homeTeam: { not: null }, awayTeam: { not: null }, kickoff: { not: null } },
    select: { homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
  });
  const index: Record<string, string> = {};
  for (const r of rows) {
    const key = matchKey(r);
    const slug = matchSlug(r);
    if (key && slug) index[key] = slug;
  }
  return index;
});

export type H2HPageData = {
  /** Null when no published prediction pairs these two teams — the route has nothing to show. */
  pair: {
    teamAName: string;
    teamBName: string;
    teamAApiId: number;
    teamBApiId: number;
    pairKey: string;
  } | null;
  /** Cached meetings, most recent first. Empty when the pair has never met OR the cache hasn't been filled yet — `fetchedAt` is what separates those. */
  meetings: H2HMeeting[];
  stats: H2HStats | null;
  fetchedAt: Date | null;
  /** Published predictions between these two, newest first — the fixtures this record is context for. */
  rows: ScopedResult["rows"];
};

/**
 * Everything /predictions/h2h/[slug] renders.
 *
 * The pair is resolved from published predictions rather than from the slug's
 * two halves: the slug is name-derived (and alphabetically ordered), while
 * every figure on the page keys off API team ids, so the ids have to come from
 * a row that actually names both teams. Any published prediction between the
 * two carries both ids — that's the same resolution the match page does, just
 * without the date.
 *
 * `teamA` is the alphabetically-first side, matching the slug's own ordering,
 * so the page's split columns line up with its URL and title.
 */
export const getH2HBySlug = cache(async (slug: string): Promise<H2HPageData> => {
  const candidates = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", homeTeam: { not: null }, awayTeam: { not: null } },
    orderBy: { kickoff: "desc" },
    select: SCOPED_SELECT,
  });
  const rows = candidates.filter((r) => h2hSlug(r.homeTeam, r.awayTeam) === slug);
  const withIds = rows.find((r) => r.homeTeamApiId != null && r.awayTeamApiId != null);

  if (rows.length === 0 || !withIds) return { pair: null, meetings: [], stats: null, fetchedAt: null, rows };

  // Orient A/B alphabetically, the same way h2hSlug orders the URL.
  const home = { name: withIds.homeTeam!, id: withIds.homeTeamApiId! };
  const away = { name: withIds.awayTeam!, id: withIds.awayTeamApiId! };
  const [teamA, teamB] = teamSlug(home.name) < teamSlug(away.name) ? [home, away] : [away, home];
  const pairKey = h2hPairKey(teamA.id, teamB.id)!;

  const cached = await prisma.h2HCache.findUnique({ where: { pairKey } });
  const meetings = cached?.fetchedAt ? ((cached.meetingsJson as unknown as H2HMeeting[] | null) ?? []) : [];

  return {
    pair: { teamAName: teamA.name, teamBName: teamB.name, teamAApiId: teamA.id, teamBApiId: teamB.id, pairKey },
    meetings,
    stats: cached?.fetchedAt ? computeH2HStats(meetings, teamA.id, teamB.id) : null,
    fetchedAt: cached?.fetchedAt ?? null,
    rows,
  };
});

/**
 * Distinct opponents a team has published predictions against, each with the
 * h2h slug for that pairing — backs the "Head-to-head records" list on a team
 * page. Ordered by how many published picks the pairing has, then by name.
 */
export const getOpponentsForTeamSlug = cache(async (slug: string): Promise<{ name: string; h2hSlug: string; count: number }[]> => {
  const { rows } = await getPublishedByTeamSlug(slug);
  const byOpponent = new Map<string, { name: string; h2hSlug: string; count: number }>();
  for (const r of rows) {
    if (!r.homeTeam || !r.awayTeam) continue;
    const isHome = teamSlug(r.homeTeam) === slug;
    const opponent = isHome ? r.awayTeam : r.homeTeam;
    const pairSlug = h2hSlug(r.homeTeam, r.awayTeam);
    if (!pairSlug || teamSlug(opponent) === slug) continue;
    const existing = byOpponent.get(pairSlug);
    if (existing) existing.count++;
    else byOpponent.set(pairSlug, { name: opponent, h2hSlug: pairSlug, count: 1 });
  }
  return [...byOpponent.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
});

/** Cached venue/referee/round for a fixture, or null if no successful refresh has landed yet — same fetchedAt contract as the team/league reads below. */
export const getFixtureDetail = cache(async (key: string | null) => {
  if (!key) return null;
  const row = await prisma.fixtureDetailCache.findUnique({ where: { matchKey: key } });
  return row?.fetchedAt ? row : null;
});

export type LeagueNavItem = {
  slug: string;
  name: string;
  country: string | null;
  leagueApiId: number | null;
  count: number;
  /** Crest/flag URL, or null when we have nothing to show — callers render text-only in that case. */
  crest: string | null;
};

/**
 * Every league that has at least one PUBLISHED prediction, keyed by the same
 * leagueSlug() the /predictions/league/[slug] route resolves against, so every
 * item this returns is guaranteed to land on a page with rows. Ordered by pick
 * count desc (most active leagues first), name as tiebreaker.
 *
 * Crest resolution is two-tier, both degrading to null:
 *   1. getLeagueVisual() — country flag / competition crest for the curated
 *      MAJOR_LEAGUES ids.
 *   2. LeagueEnrichmentCache — a row with a non-null fetchedAt is proof the id
 *      resolved on api-football, so its media CDN league crest exists. This is
 *      what covers leagues outside MAJOR_LEAGUES. (The cache stores no crest
 *      column of its own — see schema.prisma — so it's used as an existence
 *      signal, not as the image source.)
 * Leagues with no leagueApiId at all (manually entered "Other" leagues) get
 * neither and render text-only.
 */
export const getLeaguesWithPublishedPredictions = cache(async (): Promise<LeagueNavItem[]> => {
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", leagueName: { not: null } },
    select: { leagueName: true, leagueApiId: true },
  });

  const bySlug = new Map<string, LeagueNavItem>();
  for (const r of rows) {
    const slug = leagueSlug(r.leagueName!, r.leagueApiId);
    const existing = bySlug.get(slug);
    if (existing) {
      existing.count++;
      continue;
    }
    const visual = getLeagueVisual(r.leagueApiId);
    bySlug.set(slug, {
      slug,
      name: r.leagueName!,
      country: visual?.country ?? null,
      leagueApiId: r.leagueApiId,
      count: 1,
      crest: visual?.src ?? null,
    });
  }

  const needsCrest = [...bySlug.values()].filter((l) => !l.crest && l.leagueApiId != null).map((l) => l.leagueApiId!);
  if (needsCrest.length > 0) {
    const enriched = await prisma.leagueEnrichmentCache.findMany({
      where: { leagueApiId: { in: needsCrest }, fetchedAt: { not: null } },
      select: { leagueApiId: true },
    });
    const known = new Set(enriched.map((e) => e.leagueApiId));
    for (const l of bySlug.values()) {
      if (!l.crest && l.leagueApiId != null && known.has(l.leagueApiId)) l.crest = leagueLogoUrl(l.leagueApiId);
    }
  }

  return [...bySlug.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
});

/**
 * The MAJOR_LEAGUES subset of `leagues`, ranked by that constant's own curated
 * order (top 5, then internationals, then mid-tier, …) rather than by pick
 * count — "popular" here means the editorial ordering already encoded in
 * MAJOR_LEAGUES, not a second popularity definition.
 */
export function popularLeagues(leagues: LeagueNavItem[]): LeagueNavItem[] {
  return leagues
    .filter((l) => isMajorLeague(l.leagueApiId))
    .sort((a, b) => MAJOR_LEAGUES.findIndex((m) => m.id === a.leagueApiId) - MAJOR_LEAGUES.findIndex((m) => m.id === b.leagueApiId));
}

/** Display name for a league page header — includes the country when the leagueApiId resolves, to disambiguate name collisions (e.g. "Premier League" is England, Kazakhstan, and Belarus). */
export function leagueDisplayName(name: string, leagueApiId: number | null): string {
  const visual = getLeagueVisual(leagueApiId);
  return visual ? `${name} (${visual.country})` : name;
}

// Enrichment cache reads for the team/league pages (src/lib/enrichment.ts is
// the only writer, via the cron at src/app/api/admin/refresh-enrichment).
// `fetchedAt` is the sole freshness signal: null means either "never
// attempted" or "attempted and failed" (e.g. today's free-plan rejection) —
// pages don't distinguish those two, they just hide the section for both.

/** Cached crest/form/stats for a team, or null if no successful refresh has landed yet. */
export const getTeamEnrichment = cache(async (teamApiId: number | null) => {
  if (teamApiId == null) return null;
  const row = await prisma.teamEnrichmentCache.findUnique({ where: { teamApiId } });
  return row?.fetchedAt ? row : null;
});

/** Cached standings/upcoming fixtures for a league, or null if no successful refresh has landed yet. */
export const getLeagueEnrichment = cache(async (leagueApiId: number | null) => {
  if (leagueApiId == null) return null;
  const row = await prisma.leagueEnrichmentCache.findUnique({ where: { leagueApiId } });
  return row?.fetchedAt ? row : null;
});
