# Field web vitals and engagement events

What the site sends to GA4 beyond page views and the three conversion events
(`sign_up`, `begin_checkout`, `purchase`), and the one-time GA4 setup needed
to report on it. Covers SEO-109 (field Core Web Vitals) and SEO-502
(prediction and track-record engagement).

Code: `src/lib/engagement.ts` (templates, event shapes),
`src/components/WebVitals.tsx`. Tests: `npm run check:engagement`.

Everything goes through the existing consent-moded GA4 tag
(`src/components/Analytics.tsx`): no new script, no new cookie, nothing in
previews or local development. No event carries a name, email, team name or
any other free text.

## Events

| Event | When | Parameters |
|---|---|---|
| `LCP`, `INP`, `CLS` | Next.js reports a field metric for the page (once or more per page view) | `value` (integer; CLS × 1000), `metric_value`, `metric_id`, `metric_rating` (`good` / `needs-improvement` / `poor`), `page_template` |
| `prediction_reasoning_open` | A reader opens "Show full reasoning" on a pick | `page_template` |
| `prediction_view_change` | A reader switches Detailed / Compact | `view`, `page_template` |
| `track_record_day_open` | A reader opens a past day in VIP, Premium or Banker results | `feed_category`, `days_ago`, `page_template` |
| `track_record_more_days` | A reader taps "Show more days" there | `feed_category`, `days_shown`, `page_template` |

`page_template` is the kind of page, not its URL: `home`, `predictions_hub`,
`category_feed`, `match`, `league`, `cup`, `team`, `h2h`, `guides_hub`,
`guide`, `track_record`, `pricing`, `trust`, and so on (`pageTemplate` in
`src/lib/engagement.ts`). Reports compare templates instead of thousands of
individual URLs.

## One-time GA4 setup (owner)

1. GA4 → Admin → Custom definitions → **Create custom dimension**, scope
   **Event**, once for each of: `page_template`, `metric_rating`,
   `feed_category`, `view`.
2. Optionally create a custom metric, scope **Event**, for `metric_value`
   (unit: milliseconds; standard for CLS).
3. Dimensions only collect data from the moment they are registered, so do it
   on the day this deploys.

## Reading field vitals (SEO-109 acceptance)

- **Quick view:** Explore → Free form. Rows: `Event name` (filter to LCP, INP,
  CLS), then `page_template`. Columns: `Device category`. Values: `Event count`
  split by `metric_rating`. The share of `good` per template on mobile is the
  working signal.
- **True p75:** GA4's interface does not compute percentiles. Link GA4 to
  BigQuery (Admin → BigQuery links, free tier) and take
  `APPROX_QUANTILES(value, 100)[OFFSET(75)]` per event name, template and
  device. Google's thresholds at p75: LCP ≤ 2,500 ms, INP ≤ 200 ms,
  CLS ≤ 0.1 (100 in the scaled `value`).
- Search Console → Core Web Vitals remains the authoritative view Google
  ranks on; this adds the per-template breakdown it does not have.
