import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

// login/register are intentionally NOT disallowed here — they're already
// noindex (see their layout.tsx metadata) with follow: true, which needs
// crawling to take effect. Blocking them via robots.txt would stop crawlers
// from seeing that tag at all.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /ads is the ad frame route (src/app/ads/frame/route.ts). It serves a
      // bare document holding two third-party script tags and no content of
      // its own, so there is nothing there for a crawler to want. It also
      // sends x-robots-tag: noindex, which is what covers a crawler that
      // reaches it without reading this file.
      disallow: ["/admin", "/dashboard", "/api", "/ads"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
