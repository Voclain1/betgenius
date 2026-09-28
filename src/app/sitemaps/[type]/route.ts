import { getCachedSitemapEntries } from "@/lib/sitemapCache";
import { SITEMAP_TYPES, sitemapUnavailableResponse, urlsetXml, xmlResponse, type SitemapType } from "@/lib/sitemapXml";

export const revalidate = 3600;

function parseType(value: string): SitemapType | null {
  const candidate = value.endsWith(".xml") ? value.slice(0, -4) : value;
  return (SITEMAP_TYPES as readonly string[]).includes(candidate) ? candidate as SitemapType : null;
}

export async function GET(_request: Request, { params }: { params: { type: string } }): Promise<Response> {
  const type = parseType(params.type);
  if (!type) return xmlResponse("<?xml version=\"1.0\" encoding=\"UTF-8\"?><error>Unknown sitemap</error>", 404);

  // Only this type's builder runs (see src/lib/sitemapEntries.ts), behind a
  // per-type persistent cache (src/lib/sitemapCache.ts). This catch is reached
  // only when there is no good entry to serve (a cold build that failed): it
  // answers a short-lived 503, never cached, and tells the crawler when to come
  // back. When a good but stale entry exists, a failed refresh is handled
  // inside unstable_cache — the stale sitemap is served and kept.
  try {
    return xmlResponse(urlsetXml(await getCachedSitemapEntries(type)));
  } catch (error) {
    console.error(`[sitemap] ${type}: build failed`, error);
    return sitemapUnavailableResponse();
  }
}
