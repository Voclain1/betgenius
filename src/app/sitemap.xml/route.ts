import { absoluteUrl } from "@/lib/seo";
import { SITEMAP_TYPES, sitemapIndexXml, xmlResponse } from "@/lib/sitemapXml";

export const revalidate = 3600;

export function GET(): Response {
  const urls = SITEMAP_TYPES.map((type) => absoluteUrl(`/sitemaps/${type}.xml`));
  return xmlResponse(sitemapIndexXml(urls));
}
