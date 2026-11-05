# Premium discovery redesign — batch 1

Status: visual direction approved by the owner on 5 November 2026. Application release remains gated on the required checks.

Private interactive preview: https://betgenius-editorial-review.topbook2.chatgpt.site

The isolated preview contains only sample HTML screens, the stylesheet and preview interactions. It is owner-private, requires ChatGPT sign-in, and does not change betgenius.ng. The public GitHub source branch has not been pushed.

## Scope

Homepage, prediction directory and shared category presentation, desktop and responsive web/PWA. Existing brand colours and theme preferences are retained. The homepage uses a full-width editorial composition with large typography, a match spotlight and indexed category navigation. Category feeds use horizontal navigation. Category cards make free-account and member access easier to understand. Match pages and other product areas are scheduled for later batches.

The installed app in this repository is the web/PWA shell. No separate native mobile source was found in this checkout.

## Preservation audit

| Existing surface or behaviour | Implementation in this batch |
| --- | --- |
| Homepage highlights and live score updates | Original TopMatches component, selection and polling retained |
| Dynamic headline and answer summary | Original homeHeadline/homeSummary outputs passed into HomeMasthead |
| Top-pick carousel, swipe, autoplay and settled outcomes | Existing HeroSlider logic retained; surfaces and controls restyled |
| All category, market, weekend and midweek shortcuts | Original link lists and MarketChips retained in HomeCategoryNav |
| Genius and Featured day views | Same queries, row order, day URLs, tables and links |
| Bet of the Day | Original card, real pick, odds, provenance and reasoning link retained |
| Competition links and published counts | DayCompetitions and its source unchanged |
| Recent results and expand control | Original RecentResults and snapshot unchanged |
| Full league directory | Original LeagueNav unchanged |
| Livescores, Bet builder and StatsPad | Original homepage tool links retained |
| SEO guide, FAQs, internal links and structured data | HomepageExplainer and JSON-LD unchanged |
| Advertising | Existing slots, placement and consent logic retained |
| Category counts, confidence, record and following | Existing server-derived masthead props and actions unchanged |
| Yesterday/today/tomorrow and detailed/compact | Existing URL and stored-preference behaviour unchanged |
| Banker registration and VIP/Premium paywalls | Entitlement checks, shaped rows and paid covers untouched |
| Feed evidence and past results | Existing guide, evidence and FeedResults components untouched |
| Header search, dropdowns, account, notifications, theme and menu | Existing Nav controls retained |
| Installed-app navigation and safe areas | Original AppTabBar, app markers and clearance retained |
| Footer, legal pages, consent and onboarding | Original public-layout components retained |

## Review locally

After installing dependencies and generating Prisma Client, run `DESIGN_REVIEW_ENABLED=1 npm run dev`, then open `/design-review`.

Review modes: `?view=home`, `?view=categories`, `?view=today`, `?view=genius`. Add `&device=phone` for a 390px iframe that exercises the real mobile CSS and app shell. This is viewport QA, not physical-device testing.

The route is disabled unless `DESIGN_REVIEW_ENABLED` equals `1`, returns not-found otherwise and is marked noindex/nofollow. The sample fixture rows and ratings are explicitly labelled and never read or write the production database. The category directory renders its actual page; the other review screens reuse real presentation components with sample props. The review now includes sample versions of Bet of the Day, competition links, recent results, leagues, tools, ad placeholders and the actual guide/FAQ content. All live data queries and advertising integrations remain in the application.

`homepage-editorial.jpg` shows the approved direction. This is review evidence, not a screenshot of a production deployment.

## Verification

- TypeScript: passed.
- Prediction-view/access/ad rendering assertions: 139 passed.
- SEO and semantics assertions: 207 passed.
- Theme contrast: 40 passed across both themes.
- Homepage featured selection, hero selection/carousel, ad placement and app-shell checks: passed.
- Browser: desktop dark/light rendering, category navigation, 390px installed-app presentation, detailed/compact toggling and single-mounted feed verified. No horizontal page overflow in the observed desktop and mobile views.
- Actual Nav rendered with guest, reader and admin sessions at 768, 900, 1024, 1180, 1280 and 1440px: all 18 combinations had zero page/header overflow with the approved font. These were synthetic session fixtures, not live account logins.
- Paid-tier grace checks: passed. The database-mutating VIP/Premium integration suite was not run because no designated integration database is configured; its guard refused before any writes.
- Full production build: compilation and type validation passed; prerendering could not finish because this workspace has no DATABASE_URL. The affected routes were fixtures, livescores, free-ticket, Bet of the Day, track record and search. CI is required for the configured database-backed build.

Source-wiring assertions were updated for the extracted masthead and shortcut components. One already-stale Banker assertion expected “all seven”; it now checks the existing copy's “every selection” wording. The Banker content itself was not changed.

Remaining verification limits: no live authenticated account or physical iOS/Android device tests were performed in this workspace. Entitlement shaping, paid covers, live score polling, ad integrations and onboarding logic are retained. The configured production build and CI checks are required before release. No production credentials or database writes were used for this design work.

## Next batches

1. Match prediction pages: match identity, market presentation, analysis, evidence, tabs and related selections.
2. Competition/team hubs, livescores, fixtures and insights.
3. Builder, multi-bets, pricing, account and onboarding; finish cross-product consistency and device QA.

Retain the same preservation checklist and owner release gate for each batch.
