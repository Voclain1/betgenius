# Google Search Console baseline — 10 September 2026

## Scope and evidence

- Property: `sc-domain:betgenius.ng`
- Confirmed account: `realvoclain@gmail.com`
- Inspection mode: read-only; no validation request or sitemap submission was made.
- Search performance window selected: three months. Available chart data currently covers 29 August–8 September 2026 and was last updated 11 hours before inspection.

## Search performance

| Metric | Value |
|---|---:|
| Clicks | 79 |
| Impressions | 1,810 |
| CTR | 4.4% |
| Average position | 8.9 |
| Queries with data | 103 |
| Pages with data | 120 |

The current search footprint is predominantly branded. `betgenius` generated 38 clicks from 472 impressions; `betgenius prediction` generated 6 from 238; and `betgenius prediction for today` generated 3 from 115. The homepage generated 64 clicks from 731 impressions and `/predictions` generated 11 from 327. This confirms that non-brand discovery remains the main growth gap.

## Sitemap status

`https://www.betgenius.ng/sitemap.xml` was submitted on 8 September, read on 10 September, and reported **Success** with 3,895 discovered URLs and no videos.

The production parity crawler subsequently checked all 3,895 submitted URLs on 10 September: 3,895/3,895 returned directly as indexable, self-canonical HTML pages. This confirms that the indexing gap is not caused by sitemap redirects, HTTP failures, accidental noindex directives or canonical mismatches in the currently deployed sitemap.

## Page indexing

| State or reason | URLs | Assessment |
|---|---:|---|
| Indexed | 291 | Small index footprint relative to submitted inventory |
| Discovered – currently not indexed | 2,961 | Primary issue; Google has not crawled these URLs |
| Duplicate without user-selected canonical | 15 | Review canonical signals after deployment |
| Excluded by `noindex` | 14 | Mostly expected low-value or stale inventory |
| Crawled – currently not indexed | 7 | Small quality-review set |
| Page with redirect | 2 | Expected HTTP and non-www homepage redirects |

### Discovered backlog sample

The maximum 500 visible examples were classified by URL template:

| Template | URLs | Share |
|---|---:|---:|
| H2H | 331 | 66.2% |
| Dated match | 145 | 29.0% |
| League | 14 | 2.8% |
| Cup | 8 | 1.6% |
| Static/other | 2 | 0.4% |

Every sampled URL showed `Last crawled: N/A`. H2H and dated match URLs account for 95.2% of the sample. This is direct evidence that sitemap/index eligibility must be tightened around durable evidence and useful current inventory rather than expanding URL volume.

### Other exclusion samples

- Duplicate examples are mainly team URLs, with one dated match and one cup page among the first ten shown.
- Noindex examples include `/register`, stale dated match pages, and low-value team pages. These should remain excluded where the live page is intentionally non-indexable.
- The seven crawled-not-indexed URLs span match, H2H, league and team templates; they require page-level quality and canonical checks after the local SEO batch is deployed.
- The two redirected URLs are `http://betgenius.ng/` and `https://betgenius.ng/`, both expected to consolidate to the canonical HTTPS www host.

## Decision and implementation priority

1. Ship and verify the local sitemap split, H2H minimum-history threshold and match evidence threshold; do not submit a validation request before production verification.
2. Measure the resulting child-sitemap inventory before adding another age-based rule. The two evidence gates already address the H2H and match templates that form 95.2% of the sampled backlog.
3. Keep valuable URLs crawlable through hubs and internal links while removing non-indexable URLs from sitemap feeds.
4. After deployment, verify child sitemaps, canonical/robots parity, HTTP status, and Adsterra placement integrity.
5. Allow Google to recrawl, then annotate the change and monitor indexed/discovered counts weekly. Submit validation only after representative production URLs pass inspection.

## Success indicators for the next 28 days

- Submitted sitemap contains only canonical, indexable HTTP 200 URLs.
- The discovered-not-indexed ratio declines without losing impressions or clicks from useful pages.
- Non-brand impressions and the number of pages receiving impressions increase.
- Crawled-not-indexed examples are resolved, intentionally excluded, or documented by template.
- Adsterra unit keys, placement inventory, route policy, labels, reserved sizes and sandbox isolation remain unchanged.

## SEO-112 implementation decision

The first crawl-budget reduction is intentionally evidence-based rather than age-only:

- H2H URLs require at least three cached meetings before they are indexable or included in a sitemap.
- Match URLs must pass the shared substantive-evidence assessment before they are indexable or included in a sitemap.
- Empty team and league pages already emit `noindex,follow` and stay out of the sitemap.

No broader team, league, cup or historical-match pruning is justified yet. Search Console already shows impressions on individual match, league, team and H2H URLs, so a blanket age or row-count cutoff could remove useful long-tail landing pages. Reassess after the first post-deployment crawl and the pending 16-month query/page export.
