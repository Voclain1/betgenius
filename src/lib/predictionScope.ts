import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { computeStat, type WinRateStat } from "@/lib/trackRecord";
import { leagueSlug, teamSlug } from "@/lib/slug";
import { getLeagueVisual } from "@/lib/leagues";

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
