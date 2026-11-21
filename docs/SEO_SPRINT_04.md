# SEO Sprint 4 — Non-branded search measurement & CTR improvements

**Source:** Connected OpenSEO Google Search Console (Web, site https://www.betgenius.ng/), read 21 November 2026.  
**Baseline:** 22 October–18 November 2026 (28 calendar days, Pacific Time).  
**Release rule:** These numbers predate Sprints 1–4. They cannot establish any sprint's lift, and Google rankings are not guaranteed.

## What the data actually says

**Page-level GSC totals (branded + non-branded combined)**

| Page | Impressions | Clicks | CTR | Avg position | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| /predictions | 1,577 | 59 | 3.74% | 6.2 | Do not mistake brand-led visibility for generic keyword reach |
| /predictions/banker | 702 | 93 | 13.25% | 20.7 | Already attracting non-branded banker traffic; protect intent |
| /predictions/cup/danish-cup | 681 | 0 | 0% | 8.5 | Investigate click-through and internal discovery |
| /multi-bets | 452 | 21 | 4.65% | 17.6 | Establish a clear unique search title, description and canonical |
| /predictions/cup/dfb-pokal | 333 | 1 | 0.30% | 31.7 | Strengthen related competition discovery |
| /predictions/cup/fa-cup | 305 | 0 | 0% | 50.0 | Preserve indexing and consider follow-up evidence after recrawl |
| /predictions/over-2-5-goals | 55 | 6 | 10.91% | 42.5 | Insufficient volume for aggressive rewriting |
| /predictions/btts | 8 | 1 | 12.50% | — | Too little evidence for CTR conclusions |

These are page totals across ALL query types, not non-branded totals. Page-average position is not the position of the most relevant query.

**Selected query-to-page evidence (non-branded):**
- “danish cup games” → /predictions/cup/danish-cup: **517 impressions / 0 clicks / position 7.6**
- “danish cup” → same page: 73 / 0 / 14.9
- “banker predict” → /predictions/banker: 95 / 4 / 8.8
- “banker prediction” → same page: 76 / 8 / 9.7
- “all banker prediction” → same page: 51 / 11 / 7.3
- “multibet prediction” → /multi-bets: 39 / 2 / 17.5
- “multiple bet prediction” → /multi-bets: 30 / 0 / 27.8

Selected branded query-to-page rows, such as “betgenius” → /predictions (586 impressions / 21 clicks), are intentionally excluded from the non-branded sample. Queries containing *genius* without an unambiguous brand are separately labelled **ambiguous**, not automatically assigned to non-branded.

**Devices:** Across ALL queries, GSC reports mobile 12,443 impressions / 1,077 clicks, desktop 4,029 / 148 and tablet 127 / 22; this does not imply those distributions are identical for non-branded searches.

## Engineering interventions

1. Add stable, unique, search-intent-specific metadata and a self-canonical to `/multi-bets`. Never claim a specific coupon or odds are available unless actually published.
2. Make the existing Danish Cup and DFB Pokal fixture hubs discoverable from the main prediction index, with links chosen for observed **fixture** interest, not artificially promising a published tip.
3. Preserve the already-performing Banker landing page rather than unnecessarily rewriting it on the basis of thin, mixed query data.
4. Add a read-only, reproducible **query × page** non-branded reporting script with explicit branded / ambiguous / non-branded buckets and GSC sampling warnings.
5. Gate that script and the canonical/internal-link regressions in preflight. No new REST API, database changes, cron, generation, odds, paid entitlements or prediction-publication edits.

## How to reproduce the sample

```bash
npm run check:seo-nonbrand
npm run report:seo-nonbrand -- data/seo/gsc-sprint4-sample.json
```

The committed JSON file contains **selected verified rows**. It is NOT the full GSC export, a site-wide non-branded traffic estimate or evidence of a post-release improvement.

For a future report, fetch one equal-length date range of GSC Web performance grouped by `["query", "page"]`, preserving actual query/page rows and specifying the date window. Store it as `{ "source": "...", "startDate":"YYYY-MM-DD", "endDate":"YYYY-MM-DD", "dimensions":["query","page"], "sample":false, "rows":[{"keys":["query","https://www.betgenius.ng/path"], "clicks": 0, "impressions": 10, "position": 8.4 }] }`. "sample": false means a consistent **export**, not complete visibility: Google may anonymize/omit queries and the source may cap rows.

```bash
npm run report:seo-nonbrand -- data/seo/first-window.json data/seo/second-window.json
```

The comparator **refuses** trend claims on curated examples or unequal/overlapping reporting windows. For accepted windows it returns directional query-page analysis, not exhaustive site totals. CTR comes from clicks ÷ impressions, and grouped position is weighted by impressions; never sum page-level totals with query-page totals. Repeated source rows are rejected.

## Validation and next decision gates

- CI: TypeScript, check-seo, check:seo-nonbrand, sitemap, SEO link route checks, discovery, reliability and production build green.
- Live after deploy: confirm unique `/multi-bets` title/description/canonical, /predictions Danish/DFB links, no gated picks revealed, links reachable on mobile, and unchanged published match lists.
- Check indexing using GSC URL inspection; do not infer that Google adopted a new snippet from a deployment alone.
- Compare a consistently extracted 14-day diagnostic window and a full **28-day window** at least 28 days after the *actual release date*, allowing about three days of GSC lag. Record both indexed pages and query × page rows; watch effects separately for Danish Cup, DFB Pokal, Banker, multi-bets, BTTS and goals.
- A meaningful improvement must show **incremental non-branded clicks** (not just branded growth), stable indexing and no degradation in availability, mobile usability, API budget or subscriber privacy. Seasonality, changing fixtures and anonymous queries limit causal certainty.
- OpenSEO keyword-expansion requests returned `INSUFFICIENT_CREDITS`; don't publish unverifiable search volume, difficulty or conversion impact. OpenSEO's GA4-joined opportunity scoring was unavailable in this session, so no user/conversion attribution is claimed.

## Cup catalogue expansion (same PR)

**Audit:** All 32 known cup competitions were already listed by the existing cup sitemap, and all had a route-level canonical. Custom metadata existed for nine flagship competition hubs plus Danish Cup, but the remaining cup metadata relied on a generic description that sometimes mentioned data not supported by that cup's configured capabilities.

**Change:** Use one typed cup registry to show every configured cup in the main predictions hub: major cups first, then the mid-tier catalogue, and less-visited cups under a compact expandable section. The same hierarchy appears as contextual links on each cup landing page (without linking a cup to itself). Cup pages use a careful per-competition fallback SEO title and description without implying top scorers, standings or published picks exist. Keep existing curated UEFA/FA/EFL/Copa/Coppa/DFB/Coupe metadata, Danish Cup's strong GSC title and the cup season noindex/canonical rule intact.

The metadata regression gate verifies all registry slugs are represented once, have valid URLs and non-empty, appropriately bounded titles/descriptions. The broad site SEO matrix checks the existing important routes without claiming all possible dynamic URLs have been inspected in Google.

**No new football provider calls, prediction generation changes or public data exposure.** This is navigation/metadata only; Google may choose other snippets, and index/rank/CTR changes need fresh GSC data after deployment.
