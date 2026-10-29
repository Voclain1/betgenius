# Public SEO origin correction

The live sitemap index returned HTTP 200 on 29 October 2026, but all seven child locations pointed to `https://betgenius-iota.vercel.app/sitemaps/<type>.xml`. The sampled live Premier League page had the correct www.betgenius.ng canonical, so the observed mismatch is specifically confirmed for the sitemap index; this review does not assert that every live canonical is wrong.

The shared SEO helper previously derived SITE_URL from NEXTAUTH_URL and fell back to the old Vercel hostname. NEXTAUTH_URL describes authentication deployment configuration and is not a reliable source of public search identity, especially at build time. The public SEO origin is now the fixed canonical domain, https://www.betgenius.ng. Authentication settings are untouched. This also keeps metadataBase, sitemap URLs and organization/schema identity consistent across builds, including preview builds.

The existing sitemap index may be a stale build/cache artifact; the HTTP response alone cannot prove which environment value generated it. After deployment, verify that `/sitemap.xml`, its seven children and `/robots.txt` all reference the canonical domain, and sample a page canonical. If the index still exposes old locations, investigate the served build and cache rather than declaring the fix deployed successfully.

The previous results change is confirmed in the initial HTML of the sampled Premier League page: it renders the no-recent-results message rather than the loading placeholder. This is an empty-state verification, not verification of a populated result list.

Validation: 197 SEO checks, 280 sitemap checks, advertising checks, TypeScript and diff checks passed.

## Follow-up production sample

All seven child XML files returned HTTP 200 and parsed successfully: static 30, categories 15, leagues 76, cups 31, teams 2,158, matches 3,627, H2H 2,557; total 8,494 URLs. All child entries use the canonical www hostname; no within-file or cross-file duplicate URL entries were found. This does not validate every listed landing page.

Six landing pages were sampled: homepage, predictions directory, first league, Champions League cup, first team and first match. All returned HTTP 200, exactly one H1 and no robots/googlebot meta noindex. The directory declared https://betgenius-iota.vercel.app/predictions as its canonical. The other five samples declared the expected www URL (homepage without terminal slash). This expands the originally confirmed defect beyond the sitemap index to a priority static landing page. The shared origin fix addresses future builds; served static output/cache must still be verified after deployment. No claim about Google-selected canonicals is made.
