# BetGenius weekly SEO scorecard

**Goal:** grow qualified organic traffic to 10,000 monthly sessions without sacrificing index quality, site performance, responsible-gambling standards or advertising integrity.

## Baseline

| Metric | Baseline | Window | Source |
|---|---:|---|---|
| Organic sessions | 163 | 10–20 Sep 2026 | GA4 |
| Organic active users | 102 | 10–20 Sep 2026 | GA4 |
| Organic engagement rate | 73.62% | 10–20 Sep 2026 | GA4 |
| Search clicks | 232 | 29 Aug–20 Sep 2026 | Search Console |
| Search impressions | 4,286 | 29 Aug–20 Sep 2026 | Search Console |
| Search CTR | 5.41% | 29 Aug–20 Sep 2026 | Search Console |
| Average search position | 8.63 | 29 Aug–20 Sep 2026 | Search Console |
| Visible non-brand clicks | 5 | 29 Aug–20 Sep 2026 | Search Console query rows |
| Visible non-brand impressions | 646 | 29 Aug–20 Sep 2026 | Search Console query rows |
| GA4 key events | 0 | 10–20 Sep 2026 | GA4 |

The first GA4 window is eleven days, not a monthly run rate. The 10,000-session target must be assessed using complete calendar months once one exists.

## Weekly reporting table

Add one row each Monday using the previous Monday–Sunday window. Do not mix partial weeks into trend comparisons.

| Week ending | Organic sessions | Organic users | Engagement rate | GSC clicks | Impressions | CTR | Avg position | Non-brand clicks | Registrations | Checkouts | Purchases | Indexed URLs | Mobile CWV | Notes/releases |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Baseline | 163 | 102 | 73.62% | 232 | 4,286 | 5.41% | 8.63 | 5 | unavailable | unavailable | unavailable | 291 on 10 Sep | unavailable | GA4 begins 10 Sep; GSC begins 29 Aug |

## Required cuts

- Search Console: branded/non-brand, query, landing page, country, device and page-template groups.
- GA4: Organic Search channel, organic landing page, registration, checkout and purchase key events.
- Indexing: indexed, discovered-not-indexed, crawled-not-indexed, duplicate and intentional-noindex counts.
- Experience: mobile p75 LCP, INP and CLS when field data becomes available.
- Revenue: organic registrations, successful checkouts and paid subscriptions once key events are verified.

## Guardrails

- Never use a full production URL crawl for the weekly report.
- Read Search Console and GA4 aggregates through connected reporting APIs.
- Validate at most a small, documented URL sample when page-level evidence is required.
- Record releases and incidents beside the week they occurred; do not attribute causality from timing alone.
- Confirm Adsterra placements remain present after any public-page release without changing unit keys or placement policy.
