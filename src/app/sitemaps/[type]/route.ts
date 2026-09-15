import { getSitemapEntries } from "@/lib/sitemapEntries";
import { SITEMAP_TYPES, sitemapType, urlsetXml, xmlResponse, type SitemapType } from "@/lib/sitemapXml";

export const revalidate = 3600;

function parseType(value: string): SitemapType | null {
  const candidate = value.endsWith(".xml") ? value.slice(0, -4) : value;
  return (SITEMAP_TYPES as readonly string[]).includes(candidate) ? candidate as SitemapType : null;
}

export async function GET(_request: Request, { params }: { params: { type: string } }): Promise<Response> {
  const type = parseType(params.type);
  if (!type) return xmlResponse("<?xml version=\"1.0\" encoding=\"UTF-8\"?><error>Unknown sitemap</error>", 404);

  const entries = (await getSitemapEntries()).filter((entry) => sitemapType(entry.url) === type);
  return xmlResponse(urlsetXml(entries));
}
