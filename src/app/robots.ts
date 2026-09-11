import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

// /ads is the ad frame route (src/app/ads/frame/route.ts). It serves a bare
// document holding two third-party script tags and no content of its own, so
// there is nothing there for a crawler to want. It also sends
// x-robots-tag: noindex, which is what covers a crawler that reaches it
// without reading this file.
//
// SHARED by every group below, and that sharing is load-bearing. robots.txt
// specificity is winner-takes-all: a crawler obeys the single most specific
// User-agent group that matches it and ignores every other group, INCLUDING
// the "*" one. So naming an agent and giving it only a Crawl-delay would
// silently hand that agent the run of /admin, /dashboard and /api. Any named
// group has to restate the full disallow list, not extend it.
const DISALLOW = ["/admin", "/dashboard", "/api", "/ads"];

// Seconds between successive requests, asked of meta-externalagent only.
//
// Measured from production request logs (the agent= field added in 8a3bbfd):
// meta-externalagent is 93-100% of all traffic, arriving at ~11 req/min
// overall but in tight bursts — 84% of consecutive requests land less than a
// SECOND apart, with long idle gaps between runs. Bursts, not volume, are what
// make it expensive: each scoped page request is a live database read.
//
// 10s is chosen against the crawlable surface rather than picked round. The
// site publishes ~4,400 crawlable URLs, so a 10s spacing still completes a
// full pass in ~12 hours — the whole corpus remains reachable twice a day,
// which is well inside any reasonable freshness expectation for daily football
// predictions. It caps the agent at 8,640 requests/day against the ~15,800/day
// it is currently projected to make, so it roughly halves the load while
// removing the sub-second bursts entirely.
//
// Shorter would not bite: at 5s the cap is 17,280/day, ABOVE what the crawler
// currently does, so it would smooth bursts without reducing volume. Longer
// starts to cost coverage — at 30s a full pass takes 36 hours, so the site
// could no longer be crawled end-to-end within a day.
//
// CAVEAT, and it is a real one: Meta does not document Crawl-delay support.
// Their crawler documentation specifies User-agent, Allow and Disallow and
// says nothing about crawl rate, and third-party reports of compliance are
// mixed. This directive is free and is ignored harmlessly if unsupported, but
// it is a request, not a control. If the measured rate does not fall, the
// enforceable levers are Disallow (which Meta does honour) or rate limiting at
// the edge — neither of which this file can do.
const META_CRAWL_DELAY_SECONDS = 10;

// login/register are intentionally NOT disallowed here — they're already
// noindex (see their layout.tsx metadata) with follow: true, which needs
// crawling to take effect. Blocking them via robots.txt would stop crawlers
// from seeing that tag at all.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Everyone else, unchanged: Googlebot, bingbot and AhrefsBot all match
      // this group and only this group, so none of them sees a Crawl-delay.
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      {
        userAgent: "meta-externalagent",
        allow: "/",
        disallow: DISALLOW,
        crawlDelay: META_CRAWL_DELAY_SECONDS,
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
