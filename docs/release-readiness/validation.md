# Validation record

Local production build against disposable PostgreSQL 16; Node 24 locally, Node 20 in existing CI. No real provider requests or production mutations were used. Football examples are existing synthetic local fixtures, explicitly labeled in screenshots.

| Check | Result / boundary |
|---|---|
| `npm run check:release-readiness` | 86 assertions passed: return validation, registration/login wiring, accessible inputs, provider allowlist, storage handling and exact NGN/USDT payload semantics |
| `npm run check:release-confirmation-browser` | 18 assertions passed: real component with mocked session/router/verification, all providers failed/pending/unpaid, blocked sessionStorage, active confirmation and one purchase per mounted reference |
| `npm run check:release-browser` | 156 assertions passed: four-width local page/overflow checks, both chosen-plan auth links and real disposable registration/session checks |
| `npm run preflight` | 106/106 steps passed; network/DB guard retained |
| Six guarded database integrations | 6/6 passed in separate empty disposable schemas: provenance, paid gate, Bet of Day targeting, personalization, Match Centre and prediction experience |
| Focused existing regression set | 44/44 passed: payment/entitlement, publishing/reliability, category/odds/match rendering, metadata/sitemap and PostgreSQL integration suites; result manifest summarized below |
| Sprint 08 browser | 122 assertions passed; desktop/phone/small-phone, protected discovery/match APIs/HTML, preferences/saves and cached/publication comparison |
| Sprint 09 browser | 131 assertions passed at 1440/390/320, public and protected history, recorded versus checked outcomes, expired subscription; 16 screenshots |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed production build |
| `npm run check:budgets` | All 76 pages within existing unchanged budgets |
| `git diff --check` | Passed |

Full logs and the broad page screenshots are local `work/final-*` evidence; reproducible new checks are committed and added to the existing discovery CI workflow. CI run links/status belong in the PR, not an invented green badge in this document. The PR records its final tested head SHA.

## Integration isolation and repeatability

The existing safety guard refuses a target with recent JobRun activity. Tier-provenance legitimately creates observation rows, which makes a shared target unsuitable for a subsequent suite. Run each current `INTEGRATION_STEPS` entry in a fresh disposable schema/database with the normal safety opt-in and an ADMIN fixture (`example.invalid`, no credential). This sprint used six local schemas named `release_suite_0` through `release_suite_5`, with `prisma db push --skip-generate` and the existing checks unchanged. The normal host comparison used the audited deployment's real expected host identity; all actual connections were to owned localhost PostgreSQL. No production identity placeholder was invented, guard removed, broad log deletion or schema reset was used. These are disposable test namespaces, not application schema changes.

The preview's existing synthetic cached quote became stale during this long session. Only the exact preview row's fetched/update timestamp was refreshed, after checking the manifest and synthetic team identity; the freshness guard stayed intact. CI creates fresh previews. No real odds were fetched or edited.

## Review limits

Layout checks measure overflow and selected touch targets, not a complete assistive-technology audit. Local build sizes and headless browser results are not field Core Web Vitals. Real charges, webhook configuration, current runtime secrets, cron health, backup restores, field performance, search indexing and business metrics remain unverified as specified in [production-evidence.md](production-evidence.md). No visual/editorial approval is asserted.

## Existing focused regression suites

`odds-integrity`, `operations-investigation`, `prediction-operations`, `results-pass`, `period-predictions`, `notification-targeting`, `admin-jobs`, `paid-market-quality`, `league-coverage-quality`, `paid-value-integration`, `vip-premium-overlay`, `goals-generation`, `adaptive-coverage`, `subscription-entitlement`, `paystack-entitlement`, `onetime-fallback`, `prediction-reliability`, `paid-subscriber`, `paid-render`, `bulk-generation-dedupe`, `notification-digest`, `enrichment-report`, `accumulators`, `personalization`, `sprint08`, `prediction-operations-postgres`, `paid-publication-postgres`, `reliability-postgres`, `current-reliability-postgres`, `operations-investigation-postgres`, `odds-integrity-postgres`, `sprint08-postgres`, `check-match-render.tsx`, `check-match-evidence.tsx`, `check-match-lineups-odds.tsx`, `check-sitemap-scoping.tsx`, `match-centre`, `match-centre-render`, `prediction-experience`, `prediction-experience-render`, `category-navigation`, `category-navigation-render`, `odds-presentation`, `odds-presentation-render`.
