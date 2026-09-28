import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/seo";
import { leagueSlug, teamSlug, matchSlug, h2hSlug } from "@/lib/slug";
import { getSettledTotals, MIN_SETTLED_SAMPLE_SIZE } from "@/lib/trackRecord";
import { getSubstantiveH2HSlugs, getSubstantiveMatchSlugs } from "@/lib/predictionScope";
import { PREDICTION_CATEGORIES } from "@/lib/enums";
import { CATEGORY_TO_SLUG } from "@/lib/categoryPredictions";
import { isLagosToday, lagosDayBounds } from "@/lib/lagosDate";
import { CUP_CONFIGS, cupById } from "@/lib/cupConfig";
import { sitemapType, type SitemapType } from "@/lib/sitemapXml";

// One builder per child sitemap (/sitemaps/<type>.xml), each reading only what
// its own URLs need. There used to be a single function that read every
// published prediction, scored every fixture's evidence and loaded every h2h
// cache, and the route then kept the one-seventh of the result it had been
// asked for — so static.xml paid for matches.xml, and every child request
// paid for all seven. At the size the corpus had reached that ran the function
// into its 2 GB memory ceiling. Keep the builders independent: a builder must
// never call another type's builder, and the route must never build them all.

function maxDate(dates: (Date | null)[]): Date | undefined {
  const valid = dates.filter((d): d is Date => d != null);
  return valid.length ? new Date(Math.max(...valid.map((d) => d.getTime()))) : undefined;
}

/**
 * Collapse grouped rows onto their slug, keeping the latest publishedAt.
 *
 * Several groups can share one slug (two spellings that slug alike, or one
 * league name under different ids), exactly as several rows did before the
 * grouping moved into the database.
 */
function latestBySlug<T>(groups: T[], slugOf: (group: T) => string | null, publishedAtOf: (group: T) => Date | null): Map<string, Date | null> {
  const bySlug = new Map<string, Date | null>();
  for (const group of groups) {
    const slug = slugOf(group);
    if (slug == null) continue;
    const prev = bySlug.get(slug);
    bySlug.set(slug, maxDate([prev ?? null, publishedAtOf(group)]) ?? null);
  }
  return bySlug;
}

/** Entries in URL order — output is stable whatever order the database returns groups in. */
function slugEntries(
  bySlug: Map<string, Date | null>,
  path: (slug: string) => string,
  changeFrequency: "daily" | "weekly",
  priority: number,
): MetadataRoute.Sitemap {
  return [...bySlug.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([slug, lastModified]) => ({ url: absoluteUrl(path(slug)), lastModified: lastModified ?? undefined, changeFrequency, priority }));
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

/**
 * STATIC_PAGES entries that belong in `type`'s file.
 *
 * sitemapType() decides which child sitemap a URL is served from, and it files
 * /predictions (the hub) under "categories" — so that one static page has
 * always been listed in categories.xml, not static.xml. Splitting by the same
 * function keeps every URL in the file it was already submitted in.
 */
function staticPagesFor(type: SitemapType): MetadataRoute.Sitemap {
  return STATIC_PAGES.map((p) => ({ url: absoluteUrl(p.path), changeFrequency: "daily" as const, priority: p.priority })).filter(
    (entry) => sitemapType(entry.url) === type,
  );
}

async function staticEntries(): Promise<MetadataRoute.Sitemap> {
  const [latest, settled] = await Promise.all([
    prisma.prediction.aggregate({ where: { status: "PUBLISHED" }, _max: { publishedAt: true } }),
    getSettledTotals(),
  ]);

  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: latest._max.publishedAt ?? undefined, changeFrequency: "daily", priority: 1 },
    ...staticPagesFor("static"),
  ];

  // Track record — only when it clears the same sample-size gate that makes
  // the page itself indexable (src/app/(public)/track-record/page.tsx). Both
  // read getSettledTotals, so there is one definition of the count; the full
  // track-record report is not built just to answer this.
  if (settled.total >= MIN_SETTLED_SAMPLE_SIZE) {
    entries.push({ url: absoluteUrl("/track-record"), lastModified: settled.lastSettledAt ?? undefined, changeFrequency: "daily", priority: 0.7 });
  }

  return entries;
}

async function categoryEntries(): Promise<MetadataRoute.Sitemap> {
  // Every gate here is "has published picks kicking off TODAY in Lagos". The
  // database window is the Lagos calendar day's own UTC bounds, and the same
  // isLagosToday test as the pages is still applied to what comes back, so
  // the window can only ever narrow the read, never change the answer.
  const now = new Date();
  const { start, end } = lagosDayBounds(0, now);
  const todays = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: start, lt: end } },
    select: {
      kickoff: true,
      publishedAt: true,
      marketType: true,
      selection: true,
      categories: { select: { category: true } },
    },
  });
  const rows = todays.filter((r) => !!r.kickoff && isLagosToday(r.kickoff, now));

  const entries: MetadataRoute.Sitemap = staticPagesFor("categories");

  // One entry per category that actually has published rows — mirrors the
  // noindex-when-empty gate on /predictions/[category].
  for (const cat of PREDICTION_CATEGORIES) {
    const catRows = rows.filter((r) => cat === "TODAY" || r.categories.some((c) => c.category === cat));
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
    if (r.marketType !== "OVER_UNDER") return false;
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
  const bttsRows = rows.filter((r) => r.marketType === "BTTS");
  if (bttsRows.length) {
    entries.push({
      url: absoluteUrl("/predictions/btts"),
      lastModified: maxDate(bttsRows.map((r) => r.publishedAt)),
      changeFrequency: "daily",
      priority: 0.8,
    });
  }
  const doubleChanceRows = rows.filter((r) => r.marketType === "DOUBLE_CHANCE");
  if (doubleChanceRows.length) {
    entries.push({
      url: absoluteUrl("/predictions/double-chance"),
      lastModified: maxDate(doubleChanceRows.map((r) => r.publishedAt)),
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  return entries;
}

async function leagueEntries(): Promise<MetadataRoute.Sitemap> {
  // Leagues — grouped by the same leagueSlug used at read time (src/lib/slug.ts),
  // so a slug only appears here if /predictions/league/[slug] would actually
  // resolve rows for it (same empty-state exclusion as B1). The database
  // returns one row per distinct (name, id); the slug is still computed here.
  const groups = await prisma.prediction.groupBy({
    by: ["leagueName", "leagueApiId"],
    where: { status: "PUBLISHED", leagueName: { not: null } },
    _max: { publishedAt: true },
  });
  const bySlug = latestBySlug(
    groups,
    (g) => (!g.leagueName || cupById(g.leagueApiId) ? null : leagueSlug(g.leagueName, g.leagueApiId)),
    (g) => g._max.publishedAt,
  );
  return slugEntries(bySlug, (slug) => `/predictions/league/${slug}`, "weekly", 0.6);
}

async function cupEntries(): Promise<MetadataRoute.Sitemap> {
  // Cup pages exist independently of whether a prediction has been published
  // today. Their fixture/result archive is provider-backed, while lastModified
  // follows the latest published pick when one exists.
  const groups = await prisma.prediction.groupBy({
    by: ["leagueApiId"],
    where: { status: "PUBLISHED", leagueApiId: { in: CUP_CONFIGS.map((cup) => cup.id) } },
    _max: { publishedAt: true },
  });
  const latestByCup = new Map(groups.map((g) => [g.leagueApiId, g._max.publishedAt]));
  return CUP_CONFIGS.map((cup) => ({
    url: absoluteUrl(`/predictions/cup/${cup.slug}`),
    lastModified: latestByCup.get(cup.id) ?? undefined,
    changeFrequency: "daily" as const,
    priority: cup.format === "hybrid" ? 0.7 : 0.6,
  }));
}

async function teamEntries(): Promise<MetadataRoute.Sitemap> {
  // Teams — same idea, grouped by teamSlug across both homeTeam and awayTeam.
  const [home, away] = await Promise.all([
    prisma.prediction.groupBy({ by: ["homeTeam"], where: { status: "PUBLISHED", homeTeam: { not: null } }, _max: { publishedAt: true } }),
    prisma.prediction.groupBy({ by: ["awayTeam"], where: { status: "PUBLISHED", awayTeam: { not: null } }, _max: { publishedAt: true } }),
  ]);
  const names = [
    ...home.map((g) => ({ name: g.homeTeam, publishedAt: g._max.publishedAt })),
    ...away.map((g) => ({ name: g.awayTeam, publishedAt: g._max.publishedAt })),
  ];
  const bySlug = latestBySlug(names, (n) => (n.name ? teamSlug(n.name) : null), (n) => n.publishedAt);
  return slugEntries(bySlug, (slug) => `/predictions/team/${slug}`, "weekly", 0.6);
}

async function matchEntries(): Promise<MetadataRoute.Sitemap> {
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
  const [indexableSlugs, fixtures] = await Promise.all([
    getSubstantiveMatchSlugs(),
    prisma.prediction.groupBy({
      by: ["homeTeam", "awayTeam", "kickoff"],
      where: { status: "PUBLISHED", homeTeam: { not: null }, awayTeam: { not: null }, kickoff: { not: null } },
      _max: { publishedAt: true },
    }),
  ]);
  const bySlug = latestBySlug(
    fixtures,
    (f) => {
      const slug = matchSlug(f);
      return slug && indexableSlugs.has(slug) ? slug : null;
    },
    (f) => f._max.publishedAt,
  );
  return slugEntries(bySlug, (slug) => `/predictions/match/${slug}`, "weekly", 0.7);
}

async function h2hEntries(): Promise<MetadataRoute.Sitemap> {
  // Head-to-head pairings — one entry per team pair with published picks,
  // keyed by the same h2hSlug the route resolves against. Fewer than the match
  // entries, since repeated fixtures between the same two teams collapse into
  // a single pairing. The same minimum-history rule drives both this inclusion
  // and the H2H page's robots directive, keeping sitemap/index parity intact.
  const [indexableH2HSlugs, pairs] = await Promise.all([
    getSubstantiveH2HSlugs(),
    prisma.prediction.groupBy({
      by: ["homeTeam", "awayTeam"],
      where: { status: "PUBLISHED", homeTeam: { not: null }, awayTeam: { not: null } },
      _max: { publishedAt: true },
    }),
  ]);
  const bySlug = latestBySlug(
    pairs,
    (p) => {
      const slug = h2hSlug(p.homeTeam, p.awayTeam);
      return slug && indexableH2HSlugs.has(slug) ? slug : null;
    },
    (p) => p._max.publishedAt,
  );
  return slugEntries(bySlug, (slug) => `/predictions/h2h/${slug}`, "weekly", 0.6);
}

/**
 * The builder behind each child sitemap. Every SitemapType has exactly one,
 * and each returns only URLs of its own type (scripts/check-sitemap-scoping.ts
 * enforces both).
 */
export const SITEMAP_BUILDERS: Record<SitemapType, () => Promise<MetadataRoute.Sitemap>> = {
  static: staticEntries,
  categories: categoryEntries,
  leagues: leagueEntries,
  cups: cupEntries,
  teams: teamEntries,
  matches: matchEntries,
  h2h: h2hEntries,
};

/**
 * Every child sitemap's entries, concatenated — for offline checks only.
 *
 * NOT for the /sitemaps/[type] route: building all seven to serve one is the
 * failure this module was restructured to remove.
 */
export async function getSitemapEntries(): Promise<MetadataRoute.Sitemap> {
  const parts = await Promise.all(Object.values(SITEMAP_BUILDERS).map((build) => build()));
  return parts.flat();
}
