import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/seo";
import { leagueSlug, teamSlug, matchSlug, h2hSlug } from "@/lib/slug";
import { getTrackRecordData, MIN_SETTLED_SAMPLE_SIZE } from "@/lib/trackRecord";
import { PREDICTION_CATEGORIES } from "@/lib/enums";
import { isLagosToday } from "@/lib/lagosDate";

// Regenerated hourly rather than on every request — a sitemap doesn't need
// to reflect the last few minutes of publishing activity.
export const revalidate = 3600;

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
  { path: "/pricing", priority: 0.5 },
  // Low priority, but it must be crawlable: it is where the AI disclosure that
  // used to sit in the homepage headline now lives in full.
  { path: "/methodology", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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
    },
  });

  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: maxDate(rows.map((r) => r.publishedAt)), changeFrequency: "daily", priority: 1 },
    ...STATIC_PAGES.map((p) => ({ url: absoluteUrl(p.path), changeFrequency: "daily" as const, priority: p.priority })),
  ];

  // Track record — only when it clears the same sample-size gate that makes
  // the page itself indexable (src/app/(public)/track-record/page.tsx).
  const trackRecordData = await getTrackRecordData();
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
    entries.push({
      url: absoluteUrl(`/predictions/${cat.toLowerCase()}`),
      lastModified: maxDate(catRows.map((r) => r.publishedAt)),
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
    const slug = leagueSlug(r.leagueName, r.leagueApiId);
    const prev = leagueGroups.get(slug);
    leagueGroups.set(slug, maxDate([prev ?? null, r.publishedAt]) ?? null);
  }
  for (const [slug, lastModified] of leagueGroups) {
    entries.push({ url: absoluteUrl(`/predictions/league/${slug}`), lastModified: lastModified ?? undefined, changeFrequency: "weekly", priority: 0.6 });
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
  const matchGroups = new Map<string, Date | null>();
  for (const r of rows) {
    const slug = matchSlug(r);
    if (!slug) continue;
    const prev = matchGroups.get(slug);
    matchGroups.set(slug, maxDate([prev ?? null, r.publishedAt]) ?? null);
  }
  for (const [slug, lastModified] of matchGroups) {
    entries.push({ url: absoluteUrl(`/predictions/match/${slug}`), lastModified: lastModified ?? undefined, changeFrequency: "weekly", priority: 0.7 });
  }

  // Head-to-head pairings — one entry per team pair with published picks,
  // keyed by the same h2hSlug the route resolves against. Fewer than the match
  // entries, since repeated fixtures between the same two teams collapse into
  // a single pairing.
  const h2hGroups = new Map<string, Date | null>();
  for (const r of rows) {
    const slug = h2hSlug(r.homeTeam, r.awayTeam);
    if (!slug) continue;
    const prev = h2hGroups.get(slug);
    h2hGroups.set(slug, maxDate([prev ?? null, r.publishedAt]) ?? null);
  }
  for (const [slug, lastModified] of h2hGroups) {
    entries.push({ url: absoluteUrl(`/predictions/h2h/${slug}`), lastModified: lastModified ?? undefined, changeFrequency: "weekly", priority: 0.6 });
  }

  return entries;
}
