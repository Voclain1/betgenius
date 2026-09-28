import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import { absoluteUrl } from "@/lib/seo";
import { SITEMAP_BUILDERS } from "@/lib/sitemapEntries";
import { SITEMAP_TYPES, type SitemapType } from "@/lib/sitemapXml";

/**
 * Persistent, per-type cache in front of the child sitemap builders.
 *
 * unstable_cache (Next 14.2) is the Vercel Data Cache: shared by every
 * function instance, so a burst of crawler requests, a request from a
 * different region or `/sitemaps/matches.xml?anything` all reuse one build
 * instead of rebuilding per request as the CDN cache alone would allow.
 *
 * Behaviour that matters here, confirmed against
 * next/dist/server/web/spec-extension/unstable-cache.js in 14.2.15:
 *  - a stale entry is served while ONE background rebuild runs;
 *  - a background rebuild that throws is logged and the stale value is kept;
 *  - a first build that throws propagates and nothing is written, so an error
 *    can never become the cached sitemap;
 *  - entries over 2 MB are silently NOT stored (see guardSize below).
 *
 * Keyed by type (keyParts) and tagged per type, so the seven sitemaps can never
 * share or overwrite each other's entry and can be revalidated one at a time
 * with revalidateTag(`sitemap:<type>`), or all together with "sitemap".
 */

/** Bump when the cached shape changes, so a deploy never reads the old shape. */
const SITEMAP_CACHE_VERSION = "v1";

/** One hour — the same freshness the route's CDN headers advertise. */
export const SITEMAP_REVALIDATE_SECONDS = 3600;

/** The sitemap protocol's hard per-file limit. */
const SITEMAP_URL_LIMIT = 50_000;
/** Warn well before the limit so segmentation can be planned, not forced. */
const SITEMAP_URL_WARN = 40_000;
/** Next's data cache refuses entries over 2 MB (measured as it measures them); warn with headroom. */
const CACHE_ENTRY_LIMIT_BYTES = 2 * 1024 * 1024;
const CACHE_ENTRY_WARN_BYTES = 1.5 * 1024 * 1024;

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

/**
 * [path-or-url, lastModified ISO or null, changeFrequency or null, priority or null]
 *
 * Tuples of site-relative paths rather than entry objects with absolute URLs:
 * roughly half the bytes, which is what keeps the largest sitemap inside the
 * 2 MB data-cache limit for longer.
 */
export type CompactSitemapEntry = [string, string | null, ChangeFrequency | null, number | null];

export function compactEntries(entries: MetadataRoute.Sitemap): CompactSitemapEntry[] {
  const origin = absoluteUrl("/").slice(0, -1);
  return entries.map((entry) => {
    const location = entry.url.startsWith(`${origin}/`) ? entry.url.slice(origin.length) : entry.url;
    const lastModified =
      entry.lastModified == null ? null : entry.lastModified instanceof Date ? entry.lastModified.toISOString() : entry.lastModified;
    return [location, lastModified, entry.changeFrequency ?? null, entry.priority ?? null];
  });
}

export function expandEntries(compact: CompactSitemapEntry[]): MetadataRoute.Sitemap {
  return compact.map(([location, lastModified, changeFrequency, priority]) => ({
    url: location.startsWith("/") ? absoluteUrl(location) : location,
    ...(lastModified != null ? { lastModified } : {}),
    ...(changeFrequency != null ? { changeFrequency } : {}),
    ...(priority != null ? { priority } : {}),
  }));
}

/**
 * Measure, never truncate. A sitemap past the protocol limit or a cache entry
 * past the data-cache limit is logged loudly so segmentation can be planned;
 * every qualifying URL is still returned. (Past 2 MB the only consequence is
 * that the type rebuilds per request instead of hourly.)
 */
export function guardSize(type: SitemapType, compact: CompactSitemapEntry[]): { urls: number; bytes: number } {
  // Next stores JSON.stringify(result) as a string body and measures the
  // JSON.stringify of the record holding it, so measure the same way.
  const bytes = JSON.stringify(JSON.stringify(compact)).length;
  const urls = compact.length;
  if (urls > SITEMAP_URL_LIMIT) {
    console.error(`[sitemap] ${type}: ${urls} URLs exceeds the ${SITEMAP_URL_LIMIT}-URL sitemap limit — this type must be segmented`);
  } else if (urls > SITEMAP_URL_WARN) {
    console.warn(`[sitemap] ${type}: ${urls} URLs, approaching the ${SITEMAP_URL_LIMIT}-URL sitemap limit`);
  }
  if (bytes > CACHE_ENTRY_LIMIT_BYTES) {
    console.error(`[sitemap] ${type}: ${bytes} bytes exceeds the 2 MB data-cache entry limit — it will NOT be cached and rebuilds per request`);
  } else if (bytes > CACHE_ENTRY_WARN_BYTES) {
    console.warn(`[sitemap] ${type}: ${bytes} bytes, approaching the 2 MB data-cache entry limit`);
  }
  return { urls, bytes };
}

async function buildCompact(type: SitemapType): Promise<CompactSitemapEntry[]> {
  const compact = compactEntries(await SITEMAP_BUILDERS[type]());
  guardSize(type, compact);
  return compact;
}

const cachedBuilders = Object.fromEntries(
  SITEMAP_TYPES.map((type) => [
    type,
    unstable_cache(() => buildCompact(type), ["sitemap", SITEMAP_CACHE_VERSION, type], {
      revalidate: SITEMAP_REVALIDATE_SECONDS,
      tags: ["sitemap", `sitemap:${type}`],
    }),
  ]),
) as Record<SitemapType, () => Promise<CompactSitemapEntry[]>>;

/** The entries for one child sitemap, built by that type's builder alone and served from the shared cache. */
export async function getCachedSitemapEntries(type: SitemapType): Promise<MetadataRoute.Sitemap> {
  return expandEntries(await cachedBuilders[type]());
}
