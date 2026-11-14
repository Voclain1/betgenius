# Sprint 09 — performance transparency

Base: `1978bde1a632c4d30d5b7c01df45ed7cd091a065`, latest master including merged Sprint 08 PR #184. Branch: `feat/sprint09-performance`. The delivery PR records its final SHA and CI results. **No merge, deployment, production write, policy activation or visual approval is part of this work.**

## Existing capabilities reused

[Pre-implementation audit](audit.md). The existing `/track-record` navigation entry and canonical URL now lead to the new dashboard. Existing `/track-record/<month>` reports remain intact and are linked from an expandable archive; no parallel performance route or homepage promotion is introduced. The original all-time sample gate for indexing and sitemap inclusion is preserved, while filtered/member pages are noindex.

Reused capabilities include the existing market settlement resolver, minimum 20-decided sample threshold, Lagos month semantics, category/market labels, live database subscription resolver, Sprint 08 SQL access predicate, published match slugs and publication-quote evidence audit. The legacy label exports remain compatible. Publication, settlement, prediction generation, category curation, reliability observers, subscription/payment handling and provider schedulers are unchanged.

## Product and hierarchy

The dashboard shows published records, recorded settlements, verified decided records and verified win rate in one compact ruled overview. The team search has one row; period/category/market/competition/outcome filters use native GET controls inside a disclosure. Ranges cover the current partial calendar month and the preceding 0/2/5/11 months. Exact dates and viewer scope are displayed.

Monthly history uses restrained horizontal bars with textual rates and sample sizes; insufficient samples show decided counts rather than a fabricated percentage. Category and market comparisons contain only populated groups, with one row per group. Competition comparison, calculation methods and archives are expandable. Results are paginated at 20 records, newest kickoff first, linking to `/track-record/prediction/<id>` and then the existing match page when a slug is available.

Individual history shows the stored selection, publication time, latest settlement/time, recorded final score, primary category, qualifying price observation and an expandable evidence/version disclosure. It explicitly distinguishes this current stored record from an unavailable immutable original-publication/version ledger. Draft rewrite counts are not presented as published versions. Missing prices, unsupported settlements and absent correction history are explicit; no older selection or correction timestamp is invented.

The previous large masthead and repeated rate cards are replaced with compact typography, ruled comparisons and contextual disclosure. Existing branding, green accent, navigation, typography and prediction surfaces remain. There is no charting dependency or added filtering JavaScript. Screenshots are supplied for review; passing tests do not constitute design approval.

## Exact calculations

The cohort is **currently accessible PUBLISHED rows both published and kicked off within the selected Lagos period**, ending at the captured report time. Rows with missing kickoff/publication dates are outside this explicitly dated cohort. Upcoming fixtures are not historical results. Data is ordered by kickoff then ID, limited to the earliest 5,000 records; a 5,001st sentinel detects truncation. Filtering occurs within that bounded cohort, so the page explicitly asks readers to narrow the period when truncated. Counts are sample totals, not all-time or whole-database totals. History filters and pagination do not trigger unbounded history reads.

| Measure | Definition |
|---|---|
| Published records | Distinct prediction IDs in the accessible filtered cohort. Category cross-post links do not multiply records. |
| Recorded settled | Stored WON + LOST + VOID outcomes, irrespective of independent verification. |
| Other | Outcomes outside WON/LOST/VOID/PENDING, including unsupported partial-result codes. |
| Verified | Stable fixture identity; valid publication before kickoff; settlement at/after kickoff and no later than the report; nonnegative integer final scores; valid structured selection; stored outcome agrees with the existing market resolver; matching immutable publication-selection evidence is required. Unsupported markets or incomplete evidence are excluded. |
| Verified decided | Verified WON + LOST. Verified VOID is not in the rate denominator. |
| Verified win rate | Verified wins / verified wins and losses; displayed only with at least 20 decided records. This requires both publication evidence anchoring the structured selection and agreement with stored final scores. It does not reconstruct a complete original-version ledger or establish profitability. The price-evidence coverage is selective, so this is not an unbiased estimate for all published predictions. |
| Category comparison | Current stored primary category, not historical category membership or current cross-post tags. |
| Monthly history | Kickoff month in Africa/Lagos, not settlement month. |
| Longest win/loss run | Consecutive verified W/L records ordered by kickoff then ID. Void, pending, duplicate or unverifiable records break the run. Different markets on one match remain correlated observations; this is not a subscriber betting sequence. |

Different prediction IDs for the same stable fixture and market type are excluded from verification and returns, including differing selections. Provider and native fixture identities are joined transitively, so aliases cannot evade exclusion. This intentionally excludes valid multiple lines in one market type rather than choosing a favourable version. Repeated identical IDs are deduplicated once. Conflicts remain excluded when a filter/breakdown isolates one member of a conflicting group.

### Publication-price illustration

This is an indicative flat-stake illustration, **not verified executed betting ROI or subscriber earnings**. Eligibility requires score verification, no duplicate conflict, stable fixture identity, zero recorded rewrites and the existing matching immutable publication-quote observation. That audit verifies the publication evidence kind, direct-bookmaker basis, selection mapping, named sources, finite decimal price >1 and chronology before kickoff. Sprint 09 additionally requires:

- Confirmation no more than 60 seconds before publication and never after it.
- Distinct named bookmaker sources, an exact matching source count, and a recomputed source median agreeing with the stored entry price.
- No substitution from `Prediction.odds`, later caches, promotion observations or prospective research snapshots.

One unit is staked per eligible record. Net return is decimal−1 for a win, −1 for a loss, 0 for a void. ROI is total net units divided by eligible unit stakes, including refunded void stakes in the stated denominator. At least 20 eligible records are required to display ROI; eligible/excluded counts and observed net units remain explicit. No reliable partial-settlement ledger exists, so half/partial/unknown outcomes and quarter-line totals (even legacy WON/LOST rows) are excluded rather than assigned invented returns. Score-free cancellation voids remain recorded outcomes but cannot be independently verified for this illustration.

## Database, access and SEO

No schema change, migration, new production secret or new provider request is required. The bounded date query uses the existing publication-time index; stable kickoff/ID ordering and a 5,001-row cap bound returned records. The individual route uses a bounded ID lookup. Larger deployments may benefit from a dedicated status/kickoff index after a separately reviewed production query-plan assessment; no unmeasured production latency claim is made.

The existing `discoveryAccessWhere` predicate is part of the SQL WHERE **before** private selections/confirmation fields are read. Public queries never retrieve dedicated VIP/PREMIUM rows, even if cross-posted to a public category. Current database subscription expiry is applied per request; stale token tier claims do not grant access. Server-only projection reads no previousDrafts, reasoning blobs or subscriber identities. Only explicit display fields and audited quote properties render. There is no new public history API or search index. Unauthorized individual IDs return generic 404s, and their metadata remains generic.

The root is dynamic, with no shared personal-data cache; anonymous data is deduplicated only within the render request. Individual and authenticated pages are noindex, and member record responses are checked for no-store. Filter states canonicalize to `/track-record` and are noindex/follow. Structured data contains only the existing generic public breadcrumbs; no invented performance schema or private selection is placed in metadata. Existing monthly reports retain their distinct legacy aggregate methodology and URLs rather than silently rewriting their calculations.

## Validation

New coverage: **98 calculation/evidence/integrity/render assertions**, **38 real PostgreSQL assertions**, and **113 actual-browser assertions** at 1440/390/320px. PostgreSQL coverage creates a real 5,001-row bucket, tests active VIP/PREMIUM, registered-free, anonymous and expired access, checks immutable rows, and cleans up its own fixtures. Browser coverage verifies public HTML/flight/structured-data boundaries, generic paid-ID 404s, subscriber access, stale paid tokens with an expired database subscription, no-store private responses, canonical/noindex, GET search, missing-price/empty/insufficient states, version limitations and zero horizontal overflow.

All 44 existing non-browser regression suites pass, including Sprint 04–08 operational/publication/reliability/payment protections and their PostgreSQL suites. The Sprint 08 PostgreSQL suite was rerun in a fresh disposable schema: mixing preview rows into its unfiltered 60-row API fixture would crowd out its test IDs. Its 83 assertions remain unchanged. The existing track-record suite passes 71 checks; its two page-wiring assertions now require bounded entitlement-aware history and retained archive links. Existing arithmetic/archive assertions are retained.

The Sprint 08 122-assertion browser suite and navigation, compact-table and odds browser checks also pass. TypeScript and production build pass. **All 76 existing route budgets pass**, including shared JS **110.4/120 KB**; thresholds were not increased. These are build-size measurements, not field Core Web Vitals. The existing `prediction-discovery` CI job now also runs Sprint 09 pure, database, preview and browser steps and uploads the new screenshots. Final-head CI status is linked in the PR.

## Actual screenshot review

The running production-mode app uses explicitly synthetic fixtures, records, scores and named bookmaker observations in a disposable PostgreSQL database. The capture harness adds a small **SYNTHETIC LOCAL PREVIEW** label and dismisses optional notification onboarding through “Not now”. No real-world results or visual approval are claimed. Master `1978bde` is captured from the same database in development mode; its default is the current month, while the new dashboard defaults to three calendar months. This is a hierarchy comparison, not a before/after performance-results comparison.

| View | 390px | 1440px |
|---|---|---|
| Existing master | [Before](screenshots/master/390-dashboard.png) | [Before](screenshots/master/1440-dashboard.png) |
| Dashboard | [After](screenshots/current/390-dashboard.png) | [After](screenshots/current/1440-dashboard.png) |
| Category/market comparisons | [View](screenshots/current/390-breakdowns.png) | [View](screenshots/current/1440-breakdowns.png) |
| Historical results | [View](screenshots/current/390-history.png) | [View](screenshots/current/1440-history.png) |
| Individual record and version limits | [View](screenshots/current/390-record.png) | [View](screenshots/current/1440-record.png) |
| Expanded methods and return illustration | [View](screenshots/current/390-methodology.png) | [View](screenshots/current/1440-methodology.png) |
| Missing historical price | [View](screenshots/current/390-missing-price.png) | [View](screenshots/current/1440-missing-price.png) |
| Empty results | [View](screenshots/current/390-empty.png) | [View](screenshots/current/1440-empty.png) |
| Insufficient eligible sample | [View](screenshots/current/390-insufficient.png) | [View](screenshots/current/1440-insufficient.png) |

## Reproducible disposable preview

Use an empty disposable PostgreSQL 16 database at localhost:5432. These scripts validate both database URL hosts, ports and database names and require explicit test opt-in. The test password below is disposable only.

```bash
docker run --name betgenius-s09-preview -e POSTGRES_USER=betgenius -e POSTGRES_PASSWORD=disposable_ci_only -e POSTGRES_DB=betgenius_paid_ci -p 127.0.0.1:5432:5432 -d postgres:16
export DATABASE_URL=postgresql://betgenius:disposable_ci_only@127.0.0.1:5432/betgenius_paid_ci
export DATABASE_URL_UNPOOLED="$DATABASE_URL"
export BETGENIUS_DISPOSABLE_PG=yes
export NEXTAUTH_SECRET=sprint09-local-preview-only
export NEXTAUTH_URL=http://127.0.0.1:3000
npm ci
npx prisma db push --skip-generate
npm run check:sprint09
npm run check:sprint09-postgres
npx tsx scripts/preview-sprint09.ts
npm run build
npm start
```

Open `/track-record`; record IDs are in `work/sprint09-preview.json`. The guarded seed refuses an existing preview user rather than overwriting records. Recreate only that disposable container to seed again. For browser capture install the test-only driver separately (`npm install --no-save playwright-core@1.55.0`), set `CHROME_PATH` to local Chrome/Chromium and run `npm run check:sprint09-browser` with the same local secret. CI installs the driver only after the product build. No public preview deployment was created.

## Limits and review recommendation

There is no complete original-publication or settlement-correction ledger; original selections, published versions, executions, partial returns, historical category membership and missing prices cannot be recreated. The report requires publication evidence as well as score checks before reporting a verified rate and distinguishes that narrow observation from a complete version ledger. Rates, run lengths and indicative returns are cohort statistics, not match-independent inference, a subscriber strategy or future promises. Query truncation, sampling thresholds and excluded records remain visible.

The implementation is ready for review once final CI is green. Review the screenshots and these evidence limits before deciding on design approval or any separately authorized merge/deployment. Do not merge or deploy as part of Sprint 09.
