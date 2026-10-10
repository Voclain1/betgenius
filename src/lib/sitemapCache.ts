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
 * Behaviour that matters here, read from the Next 14.2.15 source
 * (server/web/spec-extension/unstable-cache.js, server/pipe-readable.js) —
 * not observed on a real Vercel deployment:
 *  - when the entry is stale, the stale sitemap is the body the triggering
 *    request receives, and a rebuild is queued on that request's waitUntil;
 *  - a route handler's waitUntil is awaited BEFORE the response is ended, so
 *    that one request does not fully close until the rebuild finishes — this
 *    is not a response that completes while the rebuild runs detached;
 *  - a rebuild that throws is caught and logged, and the previous good entry
 *    stays in place, so later requests keep receiving the good sitemap;
 *  - with no good entry (cold), a failed build propagates and nothing is
 *    written — the route answers 503, and an error never becomes the sitemap;
 *  - entries over 2 MB are silently NOT stored (see guardSize below);
 *  - the key is keyParts + the function source, never the request URL, so a
 *    query string cannot create a separate entry.
 *
 * Keyed by deployment and type (keyParts) and tagged per type: the seven
 * sitemaps never share or overwrite each other's entry, each deployment starts
 * from its own entries, and a type can be revalidated with
 * revalidateTag(`sitemap:<type>`), or all together with "sitemap".
 */

/** Bump when the cached shape changes, so a deploy never reads the old shape. */
const SITEMAP_CACHE_VERSION = "v1";

/**
 * Which deployment these entries belong to.
 *
 * Vercel's Data Cache outlives a deployment, so without this a new deployment
 * could keep serving a sitemap its predecessor built — for up to the refresh
 * interval, or longer, since whether the key changed depended on the minified
 * function source. Both values are Vercel system environment variables (the
 * deployment id and the commit it was built from); neither is a secret or a
 * database identifier. Outside Vercel — local runs, CI, the checks — it is the
 * constant "local", so tests stay deterministic.
 */
export function sitemapCacheDeployment(env: NodeJS.ProcessEnv = process.env): string {
  return env.VERCEL_DEPLOYMENT_ID || env.VERCEL_GIT_COMMIT_SHA || "local";
}

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

const deployment = sitemapCacheDeployment();

const cachedBuilders = Object.fromEntries(
  SITEMAP_TYPES.map((type) => [
    type,
    unstable_cache(() => buildCompact(type), ["sitemap", SITEMAP_CACHE_VERSION, deployment, type], {
      revalidate: SITEMAP_REVALIDATE_SECONDS,
      tags: ["sitemap", `sitemap:${type}`],
    }),
  ]),
) as Record<SitemapType, () => Promise<CompactSitemapEntry[]>>;

/** The entries for one child sitemap, built by that type's builder alone and served from the shared cache. */
export async function getCachedSitemapEntries(type: SitemapType): Promise<MetadataRoute.Sitemap> {
  return expandEntries(await cachedBuilders[type]());
}
