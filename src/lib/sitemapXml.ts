import type { MetadataRoute } from "next";

export const SITEMAP_TYPES = ["static", "categories", "leagues", "cups", "teams", "matches", "h2h"] as const;
export type SitemapType = (typeof SITEMAP_TYPES)[number];

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function sitemapType(url: string): SitemapType {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  if (parts[0] !== "predictions") return "static";
  if (parts[1] === "league") return "leagues";
  if (parts[1] === "cup") return "cups";
  if (parts[1] === "team") return "teams";
  if (parts[1] === "match") return "matches";
  if (parts[1] === "h2h") return "h2h";
  return "categories";
}

export function sitemapIndexXml(urls: string[]): string {
  const rows = urls.map((url) => `<sitemap><loc>${escapeXml(url)}</loc></sitemap>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows}</sitemapindex>`;
}

export function urlsetXml(entries: MetadataRoute.Sitemap): string {
  const rows = entries.map((entry) => {
    const lastModified = entry.lastModified
      ? `<lastmod>${escapeXml(entry.lastModified instanceof Date ? entry.lastModified.toISOString() : entry.lastModified)}</lastmod>`
      : "";
    const changeFrequency = entry.changeFrequency ? `<changefreq>${entry.changeFrequency}</changefreq>` : "";
    const priority = entry.priority == null ? "" : `<priority>${entry.priority}</priority>`;
    return `<url><loc>${escapeXml(entry.url)}</loc>${lastModified}${changeFrequency}${priority}</url>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows}</urlset>`;
}

export function xmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // An hour fresh at the edge, then up to a day of serving the last good
      // copy while one request refreshes it — a crawler burst after expiry
      // costs one rebuild, not one per request.
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

/** Seconds a crawler is asked to wait after a failed sitemap build. */
export const SITEMAP_RETRY_AFTER_SECONDS = 300;

/**
 * A failed child-sitemap build. no-store so no cache layer keeps the failure
 * in place of the sitemap, and Retry-After so a crawler backs off instead of
 * retrying straight into another rebuild.
 */
export function sitemapUnavailableResponse(): Response {
  return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><error>Sitemap temporarily unavailable</error>", {
    status: 503,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": String(SITEMAP_RETRY_AFTER_SECONDS),
    },
  });
}
