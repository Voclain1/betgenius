# SEO Sprint 3 — Topical authority and educational content

## Scope
BetGenius, 21 November 2026. PR branch: `seo/sprint-3-topical-authority-guides`.
This sprint is based on first-party GSC visibility and gaps, not invented keyword volumes.

## Search Console baseline
Period: 22 October–18 November 2026, Google Web. Query data is partly anonymized and can include ranking positions for multiple pages.
- Main `/predictions`: 1,577 impressions / 59 clicks / avg position 6.2
- Banker: 702 impressions / 93 clicks / avg position 20.7
- Multi-bets: 452 impressions / 21 clicks / avg position 17.6
- BTTS: 8 impressions / 1 click / avg position 28.6
- Over 2.5: 55 impressions / 6 clicks / avg position 42.5
- Danish Cup: 681 impressions / 0 clicks / avg position 8.5
- FA Cup: 305 impressions / 0 clicks / avg position 50.0
- Existing guide `/guides/how-to-read-football-predictions`: 26 impressions / 0 clicks / avg position 13.5.
- `/guides/over-under-goals-explained`: 25 impressions / 2 clicks / avg position 23.9.
- `multibet prediction` query: 39 impressions / 2 clicks / avg position 17.5.
These are observed impressions, **not** estimates of how many monthly searches exist for a phrase.

## Research coverage limitation
OpenSEO keyword-expansion requests for football prediction today, banker prediction, Over 2.5 goals and BTTS returned **INSUFFICIENT_CREDITS**. Do not display unverified monthly volume, keyword-difficulty or competitor metrics. This sprint prioritizes information architecture and content based on confirmed first-party search demand.

## Content additions
1. Guide: `/guides/how-to-evaluate-cup-football-predictions`
   - Clarifies competition stage, one-/two-legged ties, line-up rotation, opposition strength and 90-minute versus qualification settlement
   - Uses hypothetical examples only; no false fixtures or invented odds
   - Supports existing cup hubs without duplicating live cup fixtures
2. Guide: `/guides/how-to-check-a-multi-bet-coupon`
   - Leg-level verification, kickoff status, changing odds, correlation, void rules and worked 4.32 example
   - Does not promise a win or treat confidence ratings as calibrated probabilities
   - Complements rather than duplicates the existing accumulator maths guide

## Internal links and search intent ownership
- `/predictions` remains the primary generic football predictions landing page; educational articles support, not compete with, its transactional daily-intent content.
- The cup guide is linked from **cup** profiles only, not league profiles; this avoids irrelevant templated internal linking.
- The multi-bet coupon guide is linked from `/multi-bets` and existing accumulator guidance.
- Existing editorial guides are grouped into three coherent clusters with no duplicated guide assignments, all with clear product and responsibility links.
- The GuideArticle breadcrumb link provides an actual reader-facing route back to the library.
- Existing unique metadata, Article JSON-LD, canonical and sitemap publication architecture remain unchanged.

## Future independent authority work — not claimed done
A prospective editorial outreach shortlist should be researched for verified football-data communities, Nigerian sports publications, relevant football analysis publishers and competition-specific resources. Publish an original dataset or analysis first, then pitch it honestly as a citation-worthy resource. Do **not** buy mass backlinks or claim links exist without verified placement.

## Release checks
- Existing `check-seo`, sitemap scoping, discovery, operational, reliability, build and preflight checks green
- Each guide in one cluster; every related href points to a real route; semantic H1/H2 and accessible TOC
- Guide-specific JSON-LD and canonical indexed from sitemap, no anonymous access leaks
- No site-copy usage of prohibited terms; no guaranteed outcome assertions
- No data model, generation, confidence thresholds, paid memberships, publishing logic or API quota changes
- After deployment, inspect Google-selected canonicals and GSC queries for old/new guide and commercial landing pages over 14/28/60 days. Do not promise ranking effects.
