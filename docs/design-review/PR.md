# Approved editorial homepage and prediction discovery redesign

The existing homepage and prediction browsing UI use similar card treatments and offer limited visual hierarchy. This change introduces the owner-approved editorial composition: a full-width homepage, stronger typography, a football match spotlight and indexed category navigation. Category feeds use horizontal navigation; cards, tables and day/view controls share the same theme-aware styling.

All existing homepage sections, category/market/period destinations, day URLs, detailed/compact views, following, results history, SEO content, JSON-LD and advertising placement are retained. Prediction selection, server queries, entitlements, payments and schema are unchanged.

The design was approved after review at https://betgenius-editorial-review.topbook2.chatgpt.site. The private preview is separate from betgenius.ng and uses sample data. The optional `/design-review` route is disabled by default, explicitly environment-gated and marked noindex/nofollow.

## Validation

- TypeScript passed.
- Prediction-view/access/ad-rendering checks: 139/139.
- SEO and semantics: 207/207.
- Theme contrast: 40/40.
- Homepage featured selection, hero slider, ad placement, app shell and paid-tier grace checks passed.
- Actual header with synthetic guest, reader and admin sessions at 768, 900, 1024, 1180, 1280 and 1440px: all 18 combinations had zero header/page overflow with the approved font.
- The 390px PWA layout and detailed/compact switching were checked in the browser.
- Local production compilation and type validation passed. Full prerendering requires CI's configured database environment; this workspace has no DATABASE_URL.
- The separate database-mutating VIP/Premium integration check was not run: its safety guard correctly refused without a designated integration database. No writes occurred.

Remaining verification limits: physical iOS/Android devices, live authenticated sessions, external ad providers and push/install prompts were not tested in this workspace. Their existing logic is retained.

The preservation audit is in `docs/design-review/README.md`; `homepage-editorial.jpg` records the approved composition. The source-wiring checks follow the extracted presentation components. One stale Banker-copy assertion was updated to the existing “every selection” wording; Banker content was not changed.

Match prediction pages and other product areas follow in subsequent batches.
