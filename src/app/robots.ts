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
      disallow: ["/admin", "/dashboard", "/api"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
