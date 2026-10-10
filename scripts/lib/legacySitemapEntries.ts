/**
 * FROZEN reference: the sitemap implementation as it was on master @ fabb88b,
 * before child sitemaps were split into per-type builders.
 *
 * Test-only. scripts/check-sitemap-scoping.ts runs this and the new builders
 * over the same in-memory database and requires identical URL/lastmod sets
 * for every sitemap type. Do not "fix" or modernise this file — its value is
 * that it is the old behaviour, verbatim. It is never imported by src/.
 */
import type { MetadataRoute } from "next";
import { prisma } from "../../src/lib/prisma";
import { absoluteUrl } from "../../src/lib/seo";
import { leagueSlug, teamSlug, matchSlug, h2hSlug, h2hPairKey } from "../../src/lib/slug";
import { MIN_SETTLED_SAMPLE_SIZE } from "../../src/lib/trackRecord";
import { PREDICTION_CATEGORIES } from "../../src/lib/enums";
import { CATEGORY_TO_SLUG } from "../../src/lib/categoryPredictions";
import { isLagosToday } from "../../src/lib/lagosDate";
import { CUP_CONFIGS, cupById } from "../../src/lib/cupConfig";
import { orderForDisplay } from "../../src/lib/predictionOrdering";
import { assessMatchEvidence } from "../../src/lib/matchEvidence";
import { isSubstantiveH2H } from "../../src/lib/h2hEvidence";
import type { H2HMeeting } from "../../src/lib/h2h";
import type { TeamDigest } from "../../src/lib/ai/digest";
import type { LeagueStandingRow } from "../../src/lib/enrichment";

// --- master: src/lib/trackRecord.ts getTrackRecordData, the totalSettledAllTime part only
async function legacyTotalSettledAllTime(): Promise<number> {
  const outcomeCounts = await prisma.prediction.groupBy({
    by: ["outcome"],
    where: { status: "PUBLISHED" as const, outcome: { not: "PENDING" as const } },
    _count: { _all: true },
  });
  const outcomeCount = (outcome: string) => outcomeCounts.find((row) => row.outcome === outcome)?._count._all ?? 0;
  return outcomeCount("WON") + outcomeCount("LOST") + outcomeCount("VOID");
}

// --- master: src/lib/predictionScope.ts EVIDENCE_SELECT
const EVIDENCE_SELECT = {
  id: true,
  confidence: true,
  outcome: true,
  kickoff: true,
  publishedAt: true,
  homeTeamApiId: true,
  awayTeamApiId: true,
  leagueApiId: true,
  matchSlugKey: true,
  matchPreview: true,
  analysisJson: true,
} as const;

// --- master: src/lib/predictionScope.ts getSubstantiveH2HSlugs
export async function legacyGetSubstantiveH2HSlugs(): Promise<Set<string>> {
  const rows = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      homeTeam: { not: null },
      awayTeam: { not: null },
      homeTeamApiId: { not: null },
      awayTeamApiId: { not: null },
    },
    select: {
      homeTeam: true,
      awayTeam: true,
      homeTeamApiId: true,
      awayTeamApiId: true,
    },
  });

  const slugsByPair = new Map<string, Set<string>>();
  for (const row of rows) {
    const slug = h2hSlug(row.homeTeam, row.awayTeam);
    const pairKey = h2hPairKey(row.homeTeamApiId, row.awayTeamApiId);
    if (!slug || !pairKey) continue;
    const slugs = slugsByPair.get(pairKey);
    if (slugs) slugs.add(slug);
    else slugsByPair.set(pairKey, new Set([slug]));
  }

  if (slugsByPair.size === 0) return new Set();

  const caches = await prisma.h2HCache.findMany({
    where: { pairKey: { in: [...slugsByPair.keys()] }, fetchedAt: { not: null } },
    select: { pairKey: true, meetingsJson: true },
  });

  const substantive = new Set<string>();
  for (const cacheRow of caches) {
    const meetings = (cacheRow.meetingsJson as unknown as H2HMeeting[] | null) ?? [];
    if (!isSubstantiveH2H(meetings)) continue;
    for (const slug of slugsByPair.get(cacheRow.pairKey) ?? []) substantive.add(slug);
  }

  return substantive;
}

// --- master: src/lib/predictionScope.ts getSubstantiveMatchSlugs
export async function legacyGetSubstantiveMatchSlugs(): Promise<Set<string>> {
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", matchSlugKey: { not: null } },
    orderBy: { publishedAt: "desc" },
    select: EVIDENCE_SELECT,
  });

  // Grouped and ordered exactly as getPublishedByMatchSlug does, so the
  // preview/analysis this scores are the ones that page would surface.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const slug = r.matchSlugKey;
    if (!slug) continue;
    const group = groups.get(slug);
    if (group) group.push(r);
    else groups.set(slug, [r]);
  }

  const teamIds = new Set<number>();
  const leagueIds = new Set<number>();
  const pairKeys = new Set<string>();
  const shaped = new Map<string, { rows: typeof rows; homeTeamApiId: number | null; awayTeamApiId: number | null; leagueApiId: number | null }>();

  for (const [slug, unordered] of groups) {
    const ordered = orderForDisplay(unordered);
    const withIds = ordered.find((r) => r.homeTeamApiId != null && r.awayTeamApiId != null) ?? ordered[0];
    const leagueApiId = ordered.find((r) => r.leagueApiId != null)?.leagueApiId ?? null;
    shaped.set(slug, { rows: ordered, homeTeamApiId: withIds.homeTeamApiId, awayTeamApiId: withIds.awayTeamApiId, leagueApiId });

    for (const id of [withIds.homeTeamApiId, withIds.awayTeamApiId]) if (id != null) teamIds.add(id);
    if (leagueApiId != null) leagueIds.add(leagueApiId);
    const pairKey = h2hPairKey(withIds.homeTeamApiId, withIds.awayTeamApiId);
    if (pairKey) pairKeys.add(pairKey);
  }

  const [teamCaches, leagueCaches, h2hCaches] = await Promise.all([
    teamIds.size
      ? prisma.teamEnrichmentCache.findMany({
          where: { teamApiId: { in: [...teamIds] } },
          select: { teamApiId: true, fetchedAt: true, teamDigestJson: true },
        })
      : [],
    leagueIds.size
      ? prisma.leagueEnrichmentCache.findMany({
          where: { leagueApiId: { in: [...leagueIds] } },
          select: { leagueApiId: true, fetchedAt: true, standingsJson: true },
        })
      : [],
    pairKeys.size
      ? prisma.h2HCache.findMany({
          where: { pairKey: { in: [...pairKeys] } },
          select: { pairKey: true, fetchedAt: true, meetingsJson: true },
        })
      : [],
  ]);

  // `fetchedAt` null means "never landed" for all three caches — the same rule
  // getTeamEnrichment/getLeagueEnrichment/getH2HMeetings apply before handing
  // anything to the page.
  const digestByTeam = new Map<number, TeamDigest | null>(
    teamCaches.map((c) => [c.teamApiId, c.fetchedAt && c.teamDigestJson ? (c.teamDigestJson as unknown as TeamDigest) : null]),
  );
  const standingsByLeague = new Map<number, LeagueStandingRow[] | null>(
    leagueCaches.map((c) => [c.leagueApiId, c.fetchedAt ? ((c.standingsJson as unknown as LeagueStandingRow[] | null) ?? null) : null]),
  );
  const meetingsByPair = new Map<string, H2HMeeting[]>(
    h2hCaches.map((c) => [c.pairKey, c.fetchedAt ? ((c.meetingsJson as unknown as H2HMeeting[] | null) ?? []) : []]),
  );

  const substantive = new Set<string>();
  for (const [slug, m] of shaped) {
    const pairKey = h2hPairKey(m.homeTeamApiId, m.awayTeamApiId);
    const evidence = assessMatchEvidence({
      homeDigest: m.homeTeamApiId != null ? digestByTeam.get(m.homeTeamApiId) ?? null : null,
      awayDigest: m.awayTeamApiId != null ? digestByTeam.get(m.awayTeamApiId) ?? null : null,
      standings: m.leagueApiId != null ? standingsByLeague.get(m.leagueApiId) ?? null : null,
      homeTeamApiId: m.homeTeamApiId,
      awayTeamApiId: m.awayTeamApiId,
      h2hMeetings: pairKey ? meetingsByPair.get(pairKey) ?? [] : [],
      matchPreview: m.rows.find((r) => r.matchPreview)?.matchPreview ?? null,
      analysisJson: m.rows.find((r) => r.analysisJson)?.analysisJson ?? null,
    });
    if (evidence.substantive) substantive.add(slug);
  }

  return substantive;
}

// --- master: src/lib/sitemapEntries.ts (getTrackRecordData/getSubstantive* swapped for the frozen copies above)
function maxDate(dates: (Date | null)[]): Date | undefined {
  const valid = dates.filter((d): d is Date => d != null);
  return valid.length ? new Date(Math.max(...valid.map((d) => d.getTime()))) : undefined;
}

// Static public pages with no per-row data to derive lastModified from, and
// no noindex — see the robots checks on dashboard/admin/login/register/
// track-record/predictions/[category]/league/team pages for what's excluded.
const STATIC_PAGES: { path: string; priority: number }[] = [
  { path: "/predictions", priority: 0.9 },
  { path: "/fixtures", priority: 0.5 },
  { path: "/livescores", priority: 0.5 },
  { path: "/standings", priority: 0.5 },
  { path: "/statspad", priority: 0.5 },
  { path: "/bet-builder", priority: 0.5 },
  // /multi-bets is a plain indexable page (no metadata export, so no noindex
  // gate to mirror) — unlike the category feeds it stays listed even with no
  // published combos, because the page itself stays indexable when empty.
  { path: "/multi-bets", priority: 0.6 },
  { path: "/pricing", priority: 0.5 },
  { path: "/about", priority: 0.6 },
  { path: "/contact", priority: 0.5 },
  { path: "/privacy-policy", priority: 0.4 },
  { path: "/terms", priority: 0.4 },
  { path: "/cookie-policy", priority: 0.4 },
  { path: "/betting-disclaimer", priority: 0.6 },
  { path: "/responsible-gambling", priority: 0.6 },
  { path: "/affiliate-disclosure", priority: 0.4 },
  { path: "/methodology", priority: 0.7 },
  { path: "/editorial-policy", priority: 0.6 },
];

export async function legacyGetSitemapEntries(): Promise<MetadataRoute.Sitemap> {
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED" },
    select: {
      category: true,
      categories: { select: { category: true } },
      leagueApiId: true,
      leagueName: true,
      homeTeam: true,
      awayTeam: true,
      kickoff: true,
      publishedAt: true,
      settledAt: true,
      outcome: true,
      marketType: true,
      selection: true,
    },
  });

  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: maxDate(rows.map((r) => r.publishedAt)), changeFrequency: "daily", priority: 1 },
    ...STATIC_PAGES.map((p) => ({ url: absoluteUrl(p.path), changeFrequency: "daily" as const, priority: p.priority })),
  ];

  // Track record — only when it clears the same sample-size gate that makes
  // the page itself indexable (src/app/(public)/track-record/page.tsx).
  const trackRecordData = { totalSettledAllTime: await legacyTotalSettledAllTime() };
  if (trackRecordData.totalSettledAllTime >= MIN_SETTLED_SAMPLE_SIZE) {
    const settledDates = rows.map((r) => (r.outcome !== "PENDING" ? r.settledAt : null));
    entries.push({ url: absoluteUrl("/track-record"), lastModified: maxDate(settledDates), changeFrequency: "daily", priority: 0.7 });
  }

  // One entry per category that actually has published rows — mirrors the
  // noindex-when-empty gate on /predictions/[category].
  for (const cat of PREDICTION_CATEGORIES) {
    const catRows = rows.filter((r) => !!r.kickoff && isLagosToday(r.kickoff) && (
      cat === "TODAY" || r.categories.some((c) => c.category === cat)
    ));
    if (catRows.length === 0) continue;
    // CATEGORY_TO_SLUG, not cat.toLowerCase(). The enum and the route slug are
    // not the same string: SAME_GAME_DOUBLE lives at /predictions/combo-bets
    // and BET_OF_THE_DAY at /predictions/bet-of-the-day, so lowercasing the
    // enum produced /predictions/same_game_double and /predictions/bet_of_the_day
    // — two sitemap entries that 404. Derive from the routing table instead.
    entries.push({
      url: absoluteUrl(`/predictions/${CATEGORY_TO_SLUG[cat]}`),
      lastModified: maxDate(catRows.map((r) => r.publishedAt)),
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  // Market hubs follow the same inventory gate as their page metadata. The
  // URL is listed only while its exact selection has published picks today.
  const over25Rows = rows.filter((r) => {
    if (!r.kickoff || !isLagosToday(r.kickoff) || r.marketType !== "OVER_UNDER") return false;
    if (!r.selection || typeof r.selection !== "object" || Array.isArray(r.selection)) return false;
    const selection = r.selection as { line?: unknown; direction?: unknown };
    return selection.line === 2.5 && selection.direction === "OVER";
  });
  if (over25Rows.length) {
    entries.push({
      url: absoluteUrl("/predictions/over-2-5-goals"),
      lastModified: maxDate(over25Rows.map((r) => r.publishedAt)),
      changeFrequency: "daily",
      priority: 0.8,
    });
  }
  const bttsRows = rows.filter((r) => !!r.kickoff && isLagosToday(r.kickoff) && r.marketType === "BTTS");
  if (bttsRows.length) {
    entries.push({
      url: absoluteUrl("/predictions/btts"),
      lastModified: maxDate(bttsRows.map((r) => r.publishedAt)),
      changeFrequency: "daily",
      priority: 0.8,
    });
  }
  const doubleChanceRows = rows.filter((r) => !!r.kickoff && isLagosToday(r.kickoff) && r.marketType === "DOUBLE_CHANCE");
  if (doubleChanceRows.length) {
    entries.push({
      url: absoluteUrl("/predictions/double-chance"),
      lastModified: maxDate(doubleChanceRows.map((r) => r.publishedAt)),
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  // Leagues — grouped by the same leagueSlug used at read time (src/lib/slug.ts),
  // so a slug only appears here if /predictions/league/[slug] would actually
  // resolve rows for it (same empty-state exclusion as B1).
  const leagueGroups = new Map<string, Date | null>();
  for (const r of rows) {
    if (!r.leagueName) continue;
    if (cupById(r.leagueApiId)) continue;
    const slug = leagueSlug(r.leagueName, r.leagueApiId);
    const prev = leagueGroups.get(slug);
    leagueGroups.set(slug, maxDate([prev ?? null, r.publishedAt]) ?? null);
  }
  for (const [slug, lastModified] of leagueGroups) {
    entries.push({ url: absoluteUrl(`/predictions/league/${slug}`), lastModified: lastModified ?? undefined, changeFrequency: "weekly", priority: 0.6 });
  }

  // Cup pages exist independently of whether a prediction has been published
  // today. Their fixture/result archive is provider-backed, while lastModified
  // follows the latest published pick when one exists.
  for (const cup of CUP_CONFIGS) {
    entries.push({
      url: absoluteUrl(`/predictions/cup/${cup.slug}`),
      lastModified: maxDate(rows.filter((r) => r.leagueApiId === cup.id).map((r) => r.publishedAt)),
      changeFrequency: "daily",
      priority: cup.format === "hybrid" ? 0.7 : 0.6,
    });
  }

  // Teams — same idea, grouped by teamSlug across both homeTeam and awayTeam.
  const teamGroups = new Map<string, Date | null>();
  for (const r of rows) {
    for (const name of [r.homeTeam, r.awayTeam]) {
      if (!name) continue;
      const slug = teamSlug(name);
      const prev = teamGroups.get(slug);
      teamGroups.set(slug, maxDate([prev ?? null, r.publishedAt]) ?? null);
    }
  }
  for (const [slug, lastModified] of teamGroups) {
    entries.push({ url: absoluteUrl(`/predictions/team/${slug}`), lastModified: lastModified ?? undefined, changeFrequency: "weekly", priority: 0.6 });
  }

  // Matches — one entry per fixture, grouped by the same matchSlug the route
  // resolves against (rows with no kickoff produce no slug and no entry, the
  // same exclusion the match page itself applies). Priority above league/team
  // because this is the page a "<team> vs <team> prediction" search wants.
  //
  // Gated on the SAME evidence assessment that drives the page's robots tag
  // (src/lib/matchEvidence.ts), so a thin-evidence fixture is absent here for
  // exactly as long as its page says noindex, and reappears the moment its
  // caches warm enough to clear the bar. Listing a URL that then refuses
  // indexing is the parity error this closes.
  const indexableSlugs = await legacyGetSubstantiveMatchSlugs();
  const matchGroups = new Map<string, Date | null>();
  for (const r of rows) {
    const slug = matchSlug(r);
    if (!slug || !indexableSlugs.has(slug)) continue;
    const prev = matchGroups.get(slug);
    matchGroups.set(slug, maxDate([prev ?? null, r.publishedAt]) ?? null);
  }
  for (const [slug, lastModified] of matchGroups) {
    entries.push({ url: absoluteUrl(`/predictions/match/${slug}`), lastModified: lastModified ?? undefined, changeFrequency: "weekly", priority: 0.7 });
  }

  // Head-to-head pairings — one entry per team pair with published picks,
  // keyed by the same h2hSlug the route resolves against. Fewer than the match
  // entries, since repeated fixtures between the same two teams collapse into
  // a single pairing. The same minimum-history rule drives both this inclusion
  // and the H2H page's robots directive, keeping sitemap/index parity intact.
  const indexableH2HSlugs = await legacyGetSubstantiveH2HSlugs();
  const h2hGroups = new Map<string, Date | null>();
  for (const r of rows) {
    const slug = h2hSlug(r.homeTeam, r.awayTeam);
    if (!slug || !indexableH2HSlugs.has(slug)) continue;
    const prev = h2hGroups.get(slug);
    h2hGroups.set(slug, maxDate([prev ?? null, r.publishedAt]) ?? null);
  }
  for (const [slug, lastModified] of h2hGroups) {
    entries.push({ url: absoluteUrl(`/predictions/h2h/${slug}`), lastModified: lastModified ?? undefined, changeFrequency: "weekly", priority: 0.6 });
  }

  return entries;
}
