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
  // per-type persistent cache (src/lib/sitemapCache.ts). A failed build is a
  // short-lived 503, never a cached sitemap: the last good entry stays in the
  // data cache and the crawler is told when to come back.
  try {
    return xmlResponse(urlsetXml(await getCachedSitemapEntries(type)));
  } catch (error) {
    console.error(`[sitemap] ${type}: build failed`, error);
    return sitemapUnavailableResponse();
  }
}
