import { trackEvent } from "@/lib/clientAnalytics";

/**
 * Engagement and field-performance events for GA4 (SEO-109, SEO-502).
 *
 * Every event carries `page_template`, the kind of page it happened on, so
 * reports can compare templates (match pages against league pages, say)
 * rather than thousands of individual URLs. Payloads carry no names, emails,
 * team names or other free text: only the fixed values below and numbers.
 * The events reach GA4 through the same consent-moded tag as everything else
 * (src/components/Analytics.tsx), and are no-ops where that tag is absent.
 *
 * Register `page_template`, `metric_rating`, `feed_category` and `view` as
 * event-scoped custom dimensions in GA4 to report on them
 * (docs/SEO_ANALYTICS_EVENTS.md).
 */

/** The page template for a pathname. Pure; one label per URL shape. */
export function pageTemplate(pathname: string): string {
  const parts = pathname.split("?")[0].split("/").filter(Boolean);
  if (parts.length === 0) return "home";
  const [first, second] = parts;
  if (first === "predictions") {
    if (!second) return "predictions_hub";
    if (["league", "cup", "team", "match", "h2h"].includes(second)) return second;
    return "category_feed";
  }
  if (first === "guides") return second ? "guide" : "guides_hub";
  const known: Record<string, string> = {
    "track-record": "track_record",
    pricing: "pricing",
    fixtures: "fixtures",
    livescores: "livescores",
    standings: "standings",
    "bet-builder": "bet_builder",
    "multi-bets": "multi_bets",
    "match-insights": "match_insights",
    dashboard: "dashboard",
    register: "register",
    login: "login",
    methodology: "trust",
    "editorial-policy": "trust",
    about: "trust",
    "responsible-gambling": "trust",
  };
  return known[first] ?? "other";
}

function currentTemplate(): string {
  return typeof window === "undefined" ? "other" : pageTemplate(window.location.pathname);
}

/** An engagement event, tagged with the page template it happened on. */
export function trackEngagement(name: EngagementEvent, params: Record<string, string | number> = {}): void {
  trackEvent(name, { ...params, page_template: currentTemplate() });
}

export type EngagementEvent =
  | "prediction_reasoning_open"
  | "prediction_view_change"
  | "track_record_day_open"
  | "track_record_more_days";

/** The field metrics SEO-109 asks for. Others Next reports (FCP, TTFB, hydration timings) are not sent. */
export const FIELD_METRICS = ["LCP", "INP", "CLS"] as const;

/**
 * The GA4 event for one web-vitals report, or null for a metric not sent.
 * Shaped as Google's web-vitals guidance recommends: the event is named after
 * the metric, `value` is an integer (CLS scaled by 1000), and `metric_id`
 * lets reports group the several reports one page view can produce.
 */
export function webVitalEvent(
  metric: { name: string; value: number; delta?: number; id: string; rating?: string },
  pathname: string,
): { name: string; params: Record<string, string | number | boolean> } | null {
  if (!(FIELD_METRICS as readonly string[]).includes(metric.name)) return null;
  const scale = metric.name === "CLS" ? 1000 : 1;
  return {
    name: metric.name,
    params: {
      value: Math.round((metric.delta ?? metric.value) * scale),
      metric_value: metric.value,
      metric_id: metric.id,
      metric_rating: metric.rating ?? "unknown",
      page_template: pageTemplate(pathname),
      non_interaction: true,
    },
  };
}
