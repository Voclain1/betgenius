# BetGenius — post-deployment SEO verification (21 November 2026)

**Deployment checked:** `9ce6364` (Sprint 4), VPS workflow success.  
**Evidence source:** OpenSEO crawl + Lighthouse and Google Search Console URL inspection.  
**Important limitation:** The public web fetch service cannot load every BetGenius URL; OpenSEO crawled real HTTP pages independently. Crawl coverage is sampled, and indexed status is Google’s most recently recorded crawl, not live-test output.

## Verified observations

| Severity | Finding | Evidence | Next action |
| --- | --- | --- | --- |
| **P0** | Liga MX league hub returns HTTP **500** | `/predictions/league/liga-mx-262`, 500 in initial 50-page crawl **and** again in independent 10-page targeted crawl. Each response ~165ms. | Examine production app logs for this path using a read-only, redacted error trace. Resolve specific exception before altering the page’s shared league template. Confirm multiple 200s and add a targeted smoke test. |
| **P1** | National-team pages falsely called clubs | Public Nigeria, Somalia and Mali profiles display “club facts”/“club profile” and the generator hardcodes “football club”. | This PR changes neutral prose/headings and adds a Nigeria regression test. No invented national-team classification. |
| **P1** | Guide title too long | `/guides/how-to-evaluate-cup-football-predictions` returned HTTP 200, indexable, present in sitemap, H1 count 1, ~854 words, but rendered title was 68 characters. | Shorten title while keeping its page and content. Add a library-wide branded title budget test. |
| **P1** | New guides not yet recognised by Google | Search Console inspection: both Sprint 3 guide URLs are “URL is unknown to Google”. The cup guide is publicly accessible/indexable and in sitemap. | Recheck in Search Console after Google discovery, then diagnose if they remain undiscovered after a reasonable period. Do not confuse unknown with 404/noindex. |
| **P2** | League mobile speed | Austrian Bundesliga league page scored mobile performance 69, SEO 100, LCP ~5.33s, TTFB 526ms. Unused JS ~196KiB includes GTM, Google Sign-In and Facebook Pixel; some images have delivery opportunities. | Profile third-party loading and image sizes after P0 fix; check multiple mobile pages before generalizing. |

## Crawl scope

- Primary crawl start: `/predictions`, **50/50 pages**, with **1,536 additional URLs not crawled** due to the audit limit.
- **49 returned HTTP 200; 1 returned HTTP 500**. No other on-page critical issues were reported in this *sample*. Do not call it a full-site clean bill of health.
- Lighthouse attempted 20 device/page checks; only **4 succeeded**, the other 16 failed with `INSUFFICIENT_CREDITS`. Performance conclusions are limited to the successful checks.
- Second crawl start: `/predictions/league/liga-mx-262`; the starting URL again returned HTTP 500.
- Guide-targeted 10-page crawl found the cup-guide URL HTTP 200/indexable/in sitemap and reported a long search title; this PR corrects the title.

## Prioritized Google indexing inspection (10 URLs)

- **Indexed and canonical consistent (8):** `/predictions`, `/predictions/today`, `/predictions/banker`, `/predictions/cup/danish-cup`, `/predictions/cup/dfb-pokal`, `/predictions/cup/uefa-champions-league`, `/predictions/team/nigeria`, `/multi-bets`.
- **Unknown to Google (2):** `/guides/how-to-evaluate-cup-football-predictions` and `/guides/how-to-check-a-multi-bet-coupon`.
- The displayed Google last-crawl timestamps largely predate Sprint 4. Indexing of the *new content versions* is not yet verified.

## Scope / safeguards

This PR only changes factual team-profile copy and guide-title length, with regression tests. It does **not** alter published picks, confidence, odds, generation, API-Football, billing, membership, tier visibility, schema, deployment or scheduled jobs.

## Follow-up verification

1. **P0:** capture a read-only, redacted server stack for the Liga MX route. The current evidence is a repeated 500, not its cause. Patch the actual exception separately, and verify 200 plus correct metadata in production.
2. **P1:** merge this factual-copy PR when CI passes, deploy and recheck Nigeria, Somalia and Mali team pages; verify cup guide title length on the live page.
3. Confirm the new guide URLs through GSC inspection after recrawl, avoiding unnecessary sitemap submission loops.
4. Recheck top + middle cup page samples, the production sitemap, and mobile Lighthouse on a broader independent sample when audit credits permit.
5. At least 14 days after deployment, review impressions, clicks and CTR; at 28 days (plus GSC delay), compare branded/ambiguous/nonbranded query×page performance on equal windows.

Crawl report: https://app.openseo.so/p/96e618e8-610e-414c-9a3c-7f55092d9189/audit?auditId=50b07dc6-fbd7-4263-bfb6-d2d0717a9a14  
Liga MX reproduction: https://app.openseo.so/p/96e618e8-610e-414c-9a3c-7f55092d9189/audit?auditId=8761eec8-90b3-4716-9608-77952d8e4f18  
Guide verification: https://app.openseo.so/p/96e618e8-610e-414c-9a3c-7f55092d9189/audit?auditId=e2b84045-c2da-49e5-887f-aded58a4ecce
