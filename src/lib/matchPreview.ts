/**
 * Fixture-backed match pages before any prediction exists (issue #237).
 *
 * Source of truth is UpcomingFixture (provider-discovered, status NS). No
 * Prediction row is created or implied; nothing here reads draft or paid
 * picks. A fixture with ANY published prediction is a published page, never a
 * preview, so one fixture can never own two canonical URLs.
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { MIXED_REASSESSMENT_VISIBLE } from "@/lib/reassessment/visibility";
import { matchSlug, h2hPairKey } from "@/lib/slug";
import { leaguesInTiers } from "@/lib/leagues";
import { assessMatchEvidence, type MatchEvidence } from "@/lib/matchEvidence";
import { matchPageIndexable, matchPreviewMode, PREVIEW_INDEX_MAX_DAYS } from "@/lib/matchIndexability";
import type { TeamDigest } from "@/lib/ai/digest";
import type { H2HMeeting } from "@/lib/h2h";
import type { LeagueStandingRow } from "@/lib/enrichment";

export const PREVIEW_EVIDENCE_BATCH = 250;
/** Upper bound on fixtures considered for one sitemap build (bounded scan). */
export const PREVIEW_SITEMAP_MAX_FIXTURES = 3000;

export type PreviewFixture = {
  fixtureApiId: number; leagueApiId: number; leagueName: string;
  homeTeamApiId: number; awayTeamApiId: number; homeTeam: string; awayTeam: string;
  kickoff: Date; round: string | null;
};
const FIXTURE_SELECT = {
  fixtureApiId: true, leagueApiId: true, leagueName: true, homeTeamApiId: true, awayTeamApiId: true,
  homeTeam: true, awayTeam: true, kickoff: true, round: true,
} as const;

export type PreviewResolution =
  | { kind: "preview"; fixture: PreviewFixture; slug: string }
  | { kind: "redirect"; to: string }
  | { kind: "none"; reason: string };

const SLUG_DAY = /-(\d{4}-\d{2}-\d{2})$/;

async function publishedSlugForFixture(fixtureApiId: number): Promise<string | null> {
  const row = await prisma.prediction.findFirst({
    where: { ...MIXED_REASSESSMENT_VISIBLE, status: "PUBLISHED", fixtureApiId, matchSlugKey: { not: null } },
    orderBy: { publishedAt: "desc" },
    select: { matchSlugKey: true },
  });
  return row?.matchSlugKey ?? null;
}

/**
 * Resolve /predictions/match/<slug> to an upcoming fixture when no published
 * prediction holds the slug. Day-bounded query (no table scan); the slug is
 * re-derived per candidate and compared, never parsed apart, exactly like the
 * published resolver. Two fixtures sharing one slug is a collision → no page.
 */
export const resolvePreviewBySlug = cache(async (slug: string, now: Date = new Date()): Promise<PreviewResolution> => {
  if (matchPreviewMode() === "off") return { kind: "none", reason: "mode-off" };
  const day = SLUG_DAY.exec(slug)?.[1];
  if (!day) return { kind: "none", reason: "bad-slug" };
  const start = new Date(day + "T00:00:00.000Z");
  if (Number.isNaN(start.getTime())) return { kind: "none", reason: "bad-slug" };

  const candidates = await prisma.upcomingFixture.findMany({
    where: { kickoff: { gte: start, lt: new Date(start.getTime() + 86_400_000) } },
    select: { ...FIXTURE_SELECT, status: true },
    take: 500,
  });
  const matching = candidates.filter((c) => matchSlug(c) === slug);
  if (matching.length > 1) return { kind: "none", reason: "slug-collision" };

  if (matching.length === 1) {
    const f = matching[0];
    const published = await publishedSlugForFixture(f.fixtureApiId);
    if (published) return published === slug ? { kind: "none", reason: "published" } : { kind: "redirect", to: published };
    if (f.status !== "NS" || f.kickoff.getTime() <= now.getTime()) return { kind: "none", reason: "not-upcoming" };
    return { kind: "preview", fixture: f, slug };
  }

  // Rescheduled fixture: the old slug redirects to the current canonical page.
  try {
    const alias = await prisma.fixtureSlugAlias.findUnique({ where: { slug }, select: { fixtureApiId: true } });
    if (alias) {
      const published = await publishedSlugForFixture(alias.fixtureApiId);
      if (published && published !== slug) return { kind: "redirect", to: published };
      const current = await prisma.upcomingFixture.findUnique({ where: { fixtureApiId: alias.fixtureApiId }, select: { ...FIXTURE_SELECT, status: true } });
      const next = current && current.status === "NS" && current.kickoff.getTime() > now.getTime() ? matchSlug(current) : null;
      if (next && next !== slug) return { kind: "redirect", to: next };
    }
  } catch {
    // Alias table not migrated yet: treated as unknown, never an error page.
  }
  return { kind: "none", reason: "unknown" };
});

export type PreviewEvidence = { evidence: MatchEvidence; lastModified: Date | null };

/**
 * Evidence for preview fixtures, batched: five small reads per batch no matter
 * how many fixtures. Used by BOTH the page and the sitemap, so the gate cannot
 * diverge. lastModified is the newest fetchedAt among the evidence caches that
 * fixture actually uses — it moves only when displayed form/table/H2H data
 * moves, never from an unrelated cache or from rediscovery of the fixture.
 */
export async function previewEvidenceFor(fixtures: readonly PreviewFixture[]): Promise<Map<number, PreviewEvidence>> {
  const out = new Map<number, PreviewEvidence>();
  for (let i = 0; i < fixtures.length; i += PREVIEW_EVIDENCE_BATCH) {
    const batch = fixtures.slice(i, i + PREVIEW_EVIDENCE_BATCH);
    const teamIds = [...new Set(batch.flatMap((f) => [f.homeTeamApiId, f.awayTeamApiId]))];
    const leagueIds = [...new Set(batch.map((f) => f.leagueApiId))];
    const pairKeys = [...new Set(batch.map((f) => h2hPairKey(f.homeTeamApiId, f.awayTeamApiId)).filter((k): k is string => !!k))];
    const [teams, leagues, h2h] = await Promise.all([
      prisma.teamEnrichmentCache.findMany({ where: { teamApiId: { in: teamIds } }, select: { teamApiId: true, fetchedAt: true, teamDigestJson: true } }),
      prisma.leagueEnrichmentCache.findMany({ where: { leagueApiId: { in: leagueIds } }, select: { leagueApiId: true, fetchedAt: true, standingsJson: true } }),
      pairKeys.length ? prisma.h2HCache.findMany({ where: { pairKey: { in: pairKeys } }, select: { pairKey: true, fetchedAt: true, meetingsJson: true } }) : [],
    ]);
    const teamBy = new Map(teams.map((t) => [t.teamApiId, t]));
    const leagueBy = new Map(leagues.map((l) => [l.leagueApiId, l]));
    const h2hBy = new Map(h2h.map((h) => [h.pairKey, h]));
    for (const f of batch) {
      const home = teamBy.get(f.homeTeamApiId), away = teamBy.get(f.awayTeamApiId), league = leagueBy.get(f.leagueApiId);
      const pair = h2hPairKey(f.homeTeamApiId, f.awayTeamApiId);
      const pairRow = pair ? h2hBy.get(pair) : undefined;
      const homeDigest = home?.fetchedAt && home.teamDigestJson ? (home.teamDigestJson as unknown as TeamDigest) : null;
      const awayDigest = away?.fetchedAt && away.teamDigestJson ? (away.teamDigestJson as unknown as TeamDigest) : null;
      const evidence = assessMatchEvidence({
        homeDigest, awayDigest,
        standings: league?.fetchedAt ? ((league.standingsJson as unknown as LeagueStandingRow[] | null) ?? null) : null,
        homeTeamApiId: f.homeTeamApiId, awayTeamApiId: f.awayTeamApiId,
        h2hMeetings: pairRow?.fetchedAt ? ((pairRow.meetingsJson as unknown as H2HMeeting[] | null) ?? []) : [],
        // Preview-only pages carry no editorial: the analysis signal is never claimed.
        matchPreview: null, analysisJson: null,
      });
      const stamps = [homeDigest && home?.fetchedAt, awayDigest && away?.fetchedAt, league?.fetchedAt, pairRow?.fetchedAt].filter((d): d is Date => d instanceof Date);
      out.set(f.fixtureApiId, { evidence, lastModified: stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : null });
    }
  }
  return out;
}

/**
 * matches.xml preview entries: upcoming CORE/SECONDARY fixtures with no
 * published prediction, unique slug, and substantive evidence — judged by the
 * same matchPageIndexable the page uses. Bounded: one fixture query, one
 * published-exclusion query, and 3 reads per 250 fixtures.
 */
export type IndexablePreview = { slug: string; lastModified: Date | null; fixture: PreviewFixture };

export async function getPreviewSitemapEntries(now: Date = new Date()): Promise<{ slug: string; lastModified: Date | null }[]> {
  return (await listIndexablePreviews({ now })).map(({ slug, lastModified }) => ({ slug, lastModified }));
}

/** Indexable previews (optionally one competition), for the sitemap and crawlable listings: one rule, one query path. */
export async function listIndexablePreviews(opts: { now?: Date; leagueApiId?: number; limit?: number } = {}): Promise<IndexablePreview[]> {
  const now = opts.now ?? new Date();
  const mode = matchPreviewMode();
  if (mode !== "on") return [];
  const tierLeagues = leaguesInTiers(["CORE", "SECONDARY"]);
  if (opts.leagueApiId != null && !tierLeagues.includes(opts.leagueApiId)) return [];
  const fixtures = await prisma.upcomingFixture.findMany({
    where: {
      status: "NS", kickoff: { gt: now, lte: new Date(now.getTime() + PREVIEW_INDEX_MAX_DAYS * 86_400_000) },
      leagueApiId: opts.leagueApiId != null ? opts.leagueApiId : { in: tierLeagues },
    },
    orderBy: [{ kickoff: "asc" }, { fixtureApiId: "asc" }],
    take: opts.limit ? Math.min(opts.limit * 4, PREVIEW_SITEMAP_MAX_FIXTURES) : PREVIEW_SITEMAP_MAX_FIXTURES,
    select: FIXTURE_SELECT,
  });
  const counts = new Map<string, number>();
  const slugOf = new Map<number, string>();
  for (const f of fixtures) {
    const slug = matchSlug(f);
    if (!slug) continue;
    slugOf.set(f.fixtureApiId, slug);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const published = new Set<number>();
  const ids = fixtures.map((f) => f.fixtureApiId);
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await prisma.prediction.findMany({
      where: { ...MIXED_REASSESSMENT_VISIBLE, status: "PUBLISHED", fixtureApiId: { in: ids.slice(i, i + 1000) } },
      select: { fixtureApiId: true },
    });
    for (const r of rows) if (r.fixtureApiId != null) published.add(r.fixtureApiId);
  }
  const eligible = fixtures.filter((f) => { const s = slugOf.get(f.fixtureApiId); return s && counts.get(s) === 1 && !published.has(f.fixtureApiId); });
  const evidence = await previewEvidenceFor(eligible);
  const entries: IndexablePreview[] = [];
  for (const f of eligible) {
    const e = evidence.get(f.fixtureApiId)!;
    const decision = matchPageIndexable({ state: "preview", evidenceSubstantive: e.evidence.substantive, mode, kickoff: f.kickoff, now, leagueApiId: f.leagueApiId });
    if (decision.indexable) entries.push({ slug: slugOf.get(f.fixtureApiId)!, lastModified: e.lastModified, fixture: f });
  }
  return opts.limit ? entries.slice(0, opts.limit) : entries;
}
