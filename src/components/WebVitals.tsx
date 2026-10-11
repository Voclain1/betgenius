"use client";
import { useReportWebVitals } from "next/web-vitals";
import { trackEvent } from "@/lib/clientAnalytics";
import { webVitalEvent } from "@/lib/engagement";

/**
 * Field Core Web Vitals (LCP, INP, CLS) to GA4, per page template, from real
 * readers' devices (SEO-109). Renders nothing. Reports go through the same
 * consent-moded GA4 tag as every other event, so this adds no cookie and no
 * second script: Next.js already measures these for its own use.
 */
export function WebVitals() {
  useReportWebVitals((metric) => {
    const event = webVitalEvent(metric, window.location.pathname);
    if (event) trackEvent(event.name, event.params);
  });
  return null;
}
