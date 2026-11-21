# BetGenius SEO Sprint 2: Competition & Match Authority

Date: 2026-11-21. Code branch: `seo/sprint-2-competition-match-authority`.

## First-party Google Search Console baseline (2026-10-22 to 2026-11-18)
- `danish cup games`: 517 impressions, 0 clicks, average position 7.6; page: `/predictions/cup/danish-cup`.
- `fa cup predictions`: 15 impressions, 0 clicks, average position 48.9; page: `/predictions/cup/fa-cup`.
- DFB Pokal page: 333 impressions, 1 click, avg position 31.7 across queries.
- `juventus vs rennes prediction`: 776 impressions, 0 clicks, average position 6.7; archived match page.

The numbers above are historical observations, not a ranking projection. Query-level data is not fully exhaustive.

## Verified indexing baseline (OpenSEO GSC URL inspection)
The clean URLs for Danish Cup, DFB Pokal, FA Cup, Coppa Italia, Premier League, the Atlético Madrid–Real Madrid H2H page and the Juventus–Rennes match page were all **submitted and indexed**, with Google-selected canonicals matching the submitted URLs. Inspection on 2026-11-21. Some individual URLs have not been recrawled recently; this is not proof the new code is indexed before deployment.

## What changes
1. Cup fixture links: replace the site-wide published match index with a league-ID-bounded query, retaining exact published fixture keys. No extra API-Football requests.
2. Cup club links: use a team-ID/name-bounded publication lookup for participating clubs; do not link teams with no published predictions.
3. Match competition links: use the actual `/predictions/cup/<slug>` for cups and `/predictions/league/<slug>` for leagues from the canonical routing catalogue. Works in the match masthead, standings context and footer.
4. Cup search intent: add factual counts of listed fixtures, observed rounds, finished and forthcoming matches and a clear distinction between fixture data and published predictions. No fabricated games or results.
5. Indexed season variants: `?season=...` is usable for browsing but `noindex,follow` and points canonically to the clean cup hub.
6. Match & H2H topical authority: more explicit H2H result descriptions and contextual links to goals/BTTS without representing past results as predictions.
7. Image performance: request Next-optimized API-Sports crests at component display sizes; keep fallback for non-API-Sports hosts and loading/404 behaviour. This touches the image CDN, not the paid API-Football REST budget.

## Safety constraints
- Never alter a published prediction, remove one, or change a market, confidence, odds or its paid visibility.
- No edits to generation, publication, reassessment, payments, entitlements, database schema or API-Football REST fetching.
- The image optimizer is restricted to authorized API-Sports hostnames; other logos fall back to the original browser image path.
- Existing mobile design and sections remain intact.
- Do not confuse a cup's current fixture inventory with complete competition coverage.

## Required validations
- GitHub preflight, TypeScript, discovery, operations, reliability CI all green.
- Existing SEO, sitemap, prediction, protection and UI checks pass.
- Preview /predictions/cup/danish-cup, /predictions/cup/dfb-pokal, /predictions/cup/fa-cup, /predictions/match and /predictions/h2h on mobile and desktop.
- Validate no leaking of hidden VIP/Premium values or modified published data.
- Verify the clean canonical and the `noindex` of historic cup season query states.
- After production deploy, compare mobile Lighthouse LCP for the same cup URLs with the earlier November benchmark (Coppa Italia 63, Copa del Rey 64, Belgian Cup 72, desktop homepage 99). No claim of improvement until measured.
- Compare GSC non-branded impressions, clicks, CTR and rankings 14/28 days after release while accounting for query anonymization and search reporting delay.

No merge or deployment until CI and scope review are complete.
