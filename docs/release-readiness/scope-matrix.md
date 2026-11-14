# Consolidation scope — evidence before implementation

Base: latest master `5c6998f572d937aa6436eaa6700c975908cc25f0`, including Sprint 09 #195. One feature branch/PR; no merge or deployment authorized.

## Concurrent work

- #193 OPEN, `ccr-666ad6e8-0rzntk`: PredictionDiscovery, SearchBox, predictionDiscovery/Data and new discovery search/filter modules/tests. This sprint will test the existing master behavior, report the pending dependency and avoid all those files. No cherry-pick, merge, closure or claim that #193’s fixes are present.
- #194 OPEN, `ccr-92a10a86-td6z9y`: research workflow, isolated restore/fetch scripts and research handoff docs. Entire XGBoost workstream stays isolated and untouched. No research model activation.
- `package.json` is a shared manifest touched by those PRs; any new test-script entries are additive and may require a normal merge resolution later. No dependencies change.

## Scope decisions

| Area | Evidence | Decision |
|---|---|---|
| Discovery, Match Centre, saved/preferences, odds and performance | Existing Sprint 01–09 implementation and extensive suites; #193 separately owns finder correctness | Reuse and test, do not rebuild or redesign |
| Auth return after pricing | Pricing sends anonymous users to `/login` without callback; login defaults to dashboard; register link and registration lose requested return | Fix continuity back to chosen plan, preserving default dashboard behavior elsewhere; no automatic checkout |
| Auth callback safety | Login accepts `/\\\\evil.example`; WHATWG URL parsing resolves it to an external origin | Reject backslashes, controls and protocol-relative external destinations through a shared safe relative-return helper |
| Provider confirmation text | PaymentConfirmation uses Paystack-specific copy even when provider is Korapay/Flutterwave | Fix labels to match the existing fixed provider branches; never display arbitrary URL input |
| Browser storage availability | Purchase confirmation effect calls sessionStorage.getItem/setItem without catch; a browser SecurityError escapes the effect | Isolate storage failure from confirmation; preserve transaction-ID deduplication and add component-lifetime fallback |
| USDT checkout measurement | Pricing always sends NGN amount/currency for every method, while manual USDT uses amountUsdCents | Do not report a fictitious NGN amount. Keep checkout-count/tier/method events for USDT without monetary value; actual currency totals remain in payment records. No invented FX rate or reporting-currency decision |
| Payment authenticity/idempotency/expiry | Existing provider verification, ownership/reference binding, transactional entitlement ledger, compare-and-set and currentPeriodEnd guards | Preserve; rerun payment and entitlement tests; do not alter contracts/prices/providers |
| SEO | Existing canonical origin, evidence-gated sitemaps, robots/noindex, publication access guards and SSR | Audit/read-only probes and regressions; implement no speculative SEO changes without a demonstrated defect |
| Release workflow/rollback | Existing image-by-SHA workflow, schema check, health check and previous-image rollback | Audit and document; do not trigger deployment or change schedules/secrets |
| Production evidence | Latest deploy workflow success is visible; secret/variable metadata API returns 403 | Record bounded evidence, never infer configuration or payment health from synthetic tests |
| Business metrics | Existing consent-moded GA4/Meta events, PaymentAttempt/Subscription and JobRun records | Measurement plan using existing sources; no platform, new tracking identity or invented numbers |
| Cosmetic redesign, new articles, research tools | No demonstrated missing critical workflow | Deferred as out of scope |

QA notes: banner/source-label/navigation assertions and the writer-count assertion were stale on untouched master. Updates pin existing behavior, including the separate network/house banner reservations and all six guarded integration writers. The homepage's optional competitions panel has no link on an empty day; browser measurement checks visible section links with the unchanged 36px threshold. Existing sitemap parity diagnostics also report malformed non-array H2H cache input throwing on master; no production occurrence was observed. Keep that data-quality edge case recorded for targeted follow-up rather than claiming this sprint fixes it.
