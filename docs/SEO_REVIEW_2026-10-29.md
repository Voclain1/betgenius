# SEO review — 29 October 2026

## Scope and continuity

Continue `SEO_GROWTH_PROGRAMME.md`; its existing implementations should be verified rather than rebuilt. The new research workplan supplements that programme. No change to the owner's release approval or paid-access rules.

## Verified findings

- `/predictions` provides category and market links but no direct competition hub links. Added a competition section using the existing LinkTile/PremiumPanel design: Premier League, Champions League, Europa League and FA Cup. Cup paths come from `cupById`, so links use canonical cup routes rather than league aliases. No new database query.
- The league getter in `predictionScope.ts` reads all published rows for a league, including historical rows. An established league does not become empty simply because today has no picks. Earlier concern about daily league indexability was too broad; do not remove that empty-page safeguard on that premise.
- Empty category feeds do become noindex based on the selected day's inventory. Further evidence is needed before changing that policy.
- Live retrieved Premier League page has standings, season statistics, fixtures and player modules. Its recent-results section appeared as a loading placeholder in text retrieval; server/client rendering merits a separate review before drawing a Google-indexing conclusion.
- A HEAD request to `/sitemap.xml` returned 200 and application/xml. Subsequent Python GETs returned 403 from this environment. This does not establish a Googlebot block or a broken sitemap. No full sitemap body/parity verification completed.
- Existing repository programme records prior Search Console/GA4 baseline work and extensive SEO implementations. Those historical claims need current production verification; they are not new measurements from this review.

## Research limits

Ubersuggest expansion reached the free daily report quota. Existing keyword estimates remain provisional; no new volumes invented. Current Search Console category URLs and query/page exports are still needed for an evidence-led exclusion audit. No mass crawl or indexability change was performed.

## Release status

Competition navigation is prepared on a separate branch. Local checks and visual review must be recorded before release; live deployment verification follows the owner's approval. No rankings or traffic lift is claimed.

Validation completed: `node --import tsx scripts/check-seo.ts` (195 passed, 0 failed), `node --import tsx scripts/check-ad-placement.ts` (OK), `npx tsc --noEmit` (passed), and `git diff --check` (passed). The tsx CLI could not create its IPC socket in this environment; the checks passed via Node's tsx import loader. Desktop/390px visual review and post-deployment checks remain pending; this batch is a draft for review.
