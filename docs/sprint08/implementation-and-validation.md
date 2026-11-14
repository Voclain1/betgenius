# Sprint 08 — Prediction discovery and match intelligence

Started from `ff11995d6df8fe7b89f4dfefc62cd3e478820be8`, including PR #183; integrated latest master `0609bc9` with merged PRs #186–#188 before final validation. Delivery: [PR #184](https://github.com/Voclain1/betgenius/pull/184), branch `feat/sprint08-discovery`. The delivery message and PR record identify the final SHA and CI runs. No merge or deployment is authorized by this work.

## Repository audit and features reused

| Existing capability | Sprint 08 use |
|---|---|
| Homepage Genius/Featured selection, Bet of the Day and hero slides | Preserved; added a finder linking into the existing predictions index |
| Category feeds, Yesterday/Today/Tomorrow, detailed/compact cards and feed results | Preserved default behavior; shared finder refines a category without introducing a second selection policy |
| `/predictions` category, market and competition links | Retained; added a server-rendered discovery list above them |
| Match masthead, verdict, published reasoning, form, recent results, venue statistics, goals/BTTS rates, H2H, standings, lineups/news and track record | Retained; added a compact evidence guide and published-market comparison using the same stored sources |
| League, team, cup, H2H and market hubs; canonical match slugs | Reused without changing their URLs |
| Navigation search and published-data index | Kept the existing endpoint; restricted its public dataset to anonymous-readable predictions and bounded its candidate projection |
| Sprint 01 preferences, followed teams/leagues, preferred markets, timezone and saved predictions | Reused existing tables, entitlement resolver and save API; no new preference model |
| Existing card/header/save button, typography, panels, spacing and green/dark visual language | Reused; no sitewide redesign or new animation system |
| Sprint 04–07 publication, paid evidence, reliability and operational diagnostics | Preserved; no changes to selection, ranking, admission, settlement, publication, provider quotas or recovery policies |

## Product behavior

The homepage has a compact match finder. The predictions index shows an accessible, chronological list of published predictions. Category pages gain the same controls; their original cards/view switch/day tabs remain the default until a discovery filter is submitted. Premium covers still hide the feed when access is absent.

Controls support date, competition, either team name, market, kickoff window, match status, published category, usable named quotes, followed teams/competitions, preferred markets and saved predictions. Forms use GET and native HTML controls, with no filtering JavaScript or per-keystroke API requests. Advanced controls collapse after navigation, show an active-filter count, and keep the primary date/team search compact on phones. Reset is explicit. A small homepage day-tabs wrapping fix, full-width use of the empty result-column space for ungraded compact phone tips, and 44-pixel day/save targets prevent overflow without changing navigation or typography.

A member's stored timezone controls discovery's calendar-day boundaries and kickoff windows. Anonymous readers use Africa/Lagos. Existing category day tabs retain their Lagos-day semantics; finder dates are separately labeled in the reader's timezone. Exact calendar days, UTC+14, fractional offsets and 23/25-hour DST days are tested. Anonymous requests for an interest filter fall back to accessible browsing with a sign-in explanation. Members without matches get an honest empty state and links to existing preferences/saved pages.

The finder returns 12 rows per page, from at most 300 candidates for the selected day. SQL applies access, category, date, competition, team, market and interest filters before the cap. Stored native fixture status and identity-checked captured Match Centre results, local kickoff windows and quote eligibility are assessed against bounded cache reads before paging. Truncation is explicit; it is not presented as a whole-database total. Dates are limited to 31 days on either side of the current date. Competition controls reuse the existing catalogue and supplement it with accessible published results; unlisted selected identifiers retain a neutral label rather than inventing a competition name.

Match status is based on stored data, not a live polling promise. Terminal final/cancelled states override an upcoming prediction schedule. Discovery reuses the newer shared row-status rules: cached live codes are not a live claim; the started/awaiting filter uses the clock and confirmed end states. Conflicting fixture team/competition identity or kickoff suppresses the upcoming classification and price. An elapsed kickoff without final evidence is labeled Kicked off or Awaiting result, never automatically finished. Without a native fixture cache, upcoming rows are labeled as a stored schedule.

## Match evidence and explanations

The new guide explains the actual published market's settlement meaning. For supported total-goals, BTTS, winner, double-chance and draw-no-bet selections, it counts scored recent matches that matched the market, went against it or returned the stake. These are historical counts, not new probabilities, confidence estimates or generic generated reasons. Samples cover different opponents/competitions and are labeled accordingly. Duplicate, unscored, invalid, future and post-kickoff observations do not become supporting evidence. Unsupported or sparse cases explicitly say that a comparison cannot be made.

Original stored context is used only when the team IDs match the fixture and its recording is not future-dated and precedes publication and kickoff. Otherwise the guide labels the latest cached context and explicitly declines to reconstruct the original publication decision. Cache timestamps and older/unavailable states are separate from original-context timestamps. Existing recent-results, venue-performance, goal-trend, H2H, standings and published-reasoning sections remain linked from the guide and section navigation.

Market comparison shows only readable published selections. Each supported market has its own expandable observations, contradictory results and context provenance, resolved from that prediction’s original context rather than borrowing the headline pick’s evidence. A verified frozen publication observation is labeled as an indicative median, with named source prices and quote time. A separate latest usable cache observation shows the best of the stored named offers and its provider timestamp, or explicitly the fetch time when provider time is unavailable. They are not combined, replaced, used to claim a fill, or described as odds movement/value. No opening or historical price is fabricated.

## Source, freshness and privacy rules

- New discovery/intelligence code reads PostgreSQL and existing enrichment caches only. It does not request API-Football data or bookmaker quotes, schedule refreshes or increase quotas.
- Team/competition mapping uses stored API identifiers. A cache quote must match the prediction's provider fixture ID and exact supported market/selection. Unsupported mappings and derived prices are withheld.
- Current quotes older than the existing two-hour match-odds threshold are withheld. A recent fetch cannot make an old provider timestamp current. Missing, malformed, future-dated or unnamed offers do not become prices. Archived pre-match observations are labeled historical, not current offers.
- A publication price requires the existing publication-evidence audit, an exact matching quoted selection, and timestamps consistent with publication. Promotion-only metadata and later cache prices cannot substitute for a publication snapshot. No publication confirmation is written or mutated.
- `discoveryAccessWhere` applies the existing category and paid-only provenance rules before querying; `rowViewable` checks again before projecting an explicit result shape. No raw selection, confirmation, draft, reasoning blob or future added column crosses the discovery serialization boundary.
- FREE/registration-gated Banker/VIP/PREMIUM access remains server-resolved. Saved filtering rechecks current entitlement, including after a subscription lapses. Ordinary free picks cross-posted to paid categories keep the existing free visibility rules; dedicated paid provenance never bypasses its tier through a public tag.
- Public search excludes paid-only and registration-gated-only rows even for members; the server finder supports a member's entitled searches. Public metadata and structured descriptions continue using anonymously readable picks, even on authenticated visits. Locked match cards now use the existing allowlist rather than retaining private properties in a spread.
- Forms carry filter values, never a user ID or entitlement. Personal results are request-specific, without a shared user-data cache. Existing prediction/save API private/no-store behavior is tested.
- Canonical routes remain unchanged. Discovery filter states are `noindex, follow`, canonical to the existing clean index/category day URL. The newer shared odds figure, category-navigation taxonomy and Match Centre panels are retained. Existing match evidence-gated indexing and breadcrumb/SportsEvent markup remain intact.
- Match and editorial-evidence reads are capped at 60 rows per exact slug with the same deterministic cutoff. Market comparison renders at most 12 readable selections; all retained published cards remain below it. Public search candidates are capped at 1,000.

## Actual interface previews

All screenshots are from the actual production-mode local app in Chromium, using a disposable PostgreSQL database and **clearly synthetic preview fixtures, statistics and bookmaker labels**. They are not production fixtures, live offers or visual approval. No temporary public deployment was created.

| Page / feature | Desktop | Phone |
|---|---|---|
| Homepage finder | [1440 px](screenshots/desktop-home.png) | [390 px](screenshots/mobile-home.png) |
| Shared discovery | [1440 px](screenshots/desktop-discovery.png) | [390 px](screenshots/mobile-discovery.png) |
| Refined category | [1440 px](screenshots/desktop-category.png) | [390 px](screenshots/mobile-category.png) |
| Match verdict / navigation | [1440 px](screenshots/desktop-match.png) | [390 px](screenshots/mobile-match.png) |
| Evidence guide | [Desktop view](screenshots/desktop-evidence.png) | [Phone view](screenshots/mobile-evidence.png) |
| Market comparison | [Desktop view](screenshots/desktop-markets.png) | [Phone view](screenshots/mobile-markets.png) |
| Authenticated saved filter | — | [390 px](screenshots/mobile-saved.png) |

The browser suite dismisses the existing optional notification onboarding through “Not now” when Chrome presents it, without granting push permission or changing production notification behavior. It also verifies a 320-pixel viewport, zero document overflow, real GET submissions, anonymous/private HTML and flight boundaries, structured-data JSON, missing evidence/quotes, authenticated timezone/favourites, and the existing save API. The full synthetic screenshots/logs are also uploaded by the `prediction-discovery` CI workflow.

## Reproducible local preview

Use an isolated local PostgreSQL 16 container. The seed/test guards require this exact disposable database identity and the opt-in flag; they refuse production URLs. Commands below contain a disposable test password only.

```bash
docker run --name betgenius-s08-preview -e POSTGRES_USER=betgenius -e POSTGRES_PASSWORD=disposable_ci_only -e POSTGRES_DB=betgenius_paid_ci -p 127.0.0.1:5432:5432 -d postgres:16
export DATABASE_URL=postgresql://betgenius:disposable_ci_only@127.0.0.1:5432/betgenius_paid_ci
export DATABASE_URL_UNPOOLED="$DATABASE_URL"
export BETGENIUS_DISPOSABLE_PG=yes
export NEXTAUTH_SECRET=sprint08-local-preview-only
export NEXTAUTH_URL=http://127.0.0.1:3000
npm ci
npx prisma db push --skip-generate
npx tsx scripts/preview-sprint08.ts
npm run build
npm start
```

Open the discovery date and match URL in `work/sprint08-preview.json`. In a second terminal, with the same local secret, install the existing browser-test driver (`npm install --no-save playwright-core@1.55.0`), set `CHROME_PATH` to local Chrome/Chromium, and run `npm run check:sprint08-browser`. This seed is for an empty disposable database, not a production bootstrap. Recreate only that disposable container to seed again. The browser test's bookmark setup is idempotent.

## Validation and performance

New coverage: **91 pure/render assertions**, **83 PostgreSQL assertions**, **99 browser assertions**, and the actual Chromium suite at 1440/390/320 pixels. Existing regressions cover publication atomicity, concurrency and rollback; paid access/entitlements/payments; current-mode Sprint 06 immutable observations, selected/rejected candidates, empty sets, retries and observer failures; operations/read-only recovery; and match/SEO behavior. The consolidated local run contains 36 suites, plus 11 integrated-master Match Centre, navigation, prediction-experience and odds suites; all 47 pass. TypeScript and the production build pass.

The sitemap scope suite had one pre-existing failing assertion on untouched base `ff11995`: it forbade `coachJson` despite the established match staff-claim checks requiring that narrow cache field and its fetch timestamp. The assertion now requires those fields while continuing to forbid squad/stats blobs. This does not expand the production query; **all 280 sitemap assertions pass**.

Production-build JavaScript measurement: **75 routes pass the existing budgets**, with **110.4 KB shared JS / 120 KB budget**, **153.2 KB homepage**, **153.8 KB category page**, and **158.2 KB match page**, each below the existing **160 KB route budget**. The finder/guide/comparison are server components; save controls reuse the existing small client component. These are build-size measurements, not field Core Web Vitals or a claim about real-user conversion/performance. Final CI results and SHA are linked in the PR delivery record.

The integrated Match Centre render guard also accepts the safer allowlisted locked-row shape while still requiring an explicitly withheld outcome (77 assertions pass).

The integrated Chrome check exposed an additional 320-pixel compact-table case: a long awaiting-result label squeezed a tip into extra lines. Ungraded phone tips now span the unused result-column space; no status is shortened or hidden and desktop columns stay unchanged. The unchanged row-height/overflow assertions pass at all five tested widths.

The new `prediction-discovery` workflow runs pure/render/SEO tests, real disposable-PostgreSQL integration, a synthetic preview production build, existing performance budgets and actual Chrome browser assertions/screenshots. Existing relevant preflight, operations, paid-market, league-quality and reliability workflows remain enabled.

## Deployment requirements and limitations

No schema change, migration, new environment secret, provider budget, scheduler change, payment change or preference table is required. The product code needs only a normal separately approved deployment. No production database was mutated by implementation tests; no new policy or recovery mode was activated.

Discovery intentionally scans a bounded candidate set rather than promising unlimited history or exact totals beyond its cap. Prices and native fixture status may be absent; source timestamps do not prove a current bookmaker offer. Existing competition coverage and stale-cache retention policies remain unchanged. The guide only performs market-specific observations where supported structured selections and verified recent scores exist; it does not reconstruct missing lineup, injury, original-context or historical quote data. Search remains a bounded public index, not a personalized private search service. Browser preview testing uses synthetic data and blocked third-party network requests; it does not replace production availability checks or human visual approval.

Recommendation: ready for product/security review once final required CI is green. Review the actual screenshots, access-boundary tests and bounded-query limitations before any separately approved merge or deployment. Do not merge or deploy as part of this sprint execution.
