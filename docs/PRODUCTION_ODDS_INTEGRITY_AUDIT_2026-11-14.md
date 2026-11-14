# Production evidence and odds integrity audit — 14 November 2026

PR: https://github.com/Voclain1/betgenius/pull/183. Base: `e937d0163abf6ce080fe114803b9e77854e44aad` (merged PR #182).

## Scope and evidence

Production deployment [43573587268](https://github.com/Voclain1/betgenius/actions/runs/43573587268) succeeded at 08:01:31 UTC on the base SHA. The first production snapshot completed at **2026-11-14 08:11:58.487 UTC / 09:11:58.487 WAT** in [43574555992](https://github.com/Voclain1/betgenius/actions/runs/43574555992). A provenance/output-link follow-up succeeded in [43574986036](https://github.com/Voclain1/betgenius/actions/runs/43574986036). A retry was needed after one intervening dashboard read exceeded its existing ten-second transaction timeout; the failed transaction performed no writes.

All probes used the existing authorized workflow and database-enforced `SET TRANSACTION READ ONLY`. The targeted audit also checks `SHOW transaction_read_only`, uses statement/transaction timeouts and bounded queries, and exports aggregate metadata rather than prediction identifiers, private selections, prices, bookmaker identities, subscriber data or credentials. **Zero bookmaker/provider API calls; zero production mutations.** Raw job reports and historical publication evidence are untouched. No migration, cron change, entitlement change, policy activation, recovery execution, merge or deployment was performed.

The daily view uses the existing rolling lookback, current Lagos day boundary (23:00 UTC on the previous calendar date), three-day forward horizon, current-first ordering and 500-prediction cap. It reproduced **234 total / 234 sampled**. The weekly view reproduced **806 total / 500 sampled** and is explicitly incomplete; generation-ledger and job-history caps also remain applicable. Sequential read-only transactions are snapshots at slightly different instants, not one global serializable snapshot.

## Exact original daily findings

| Finding | Severity | Current | Historical |
|---|---|---:|---:|
| MISSING_PAID_EVIDENCE | CRITICAL | 2 | 2 |
| ODDS_STALE | WARNING | 82 | 0 |
| ODDS_MISSING | WARNING | 16 | 0 |
| SUCCESS_WITHOUT_PREDICTION_IDS | WARNING | 1 | 0 |
| DUPLICATE_SELECTION | WARNING | 0 | 1 |
| PAID_PRICE_EVIDENCE_UNAVAILABLE | INFO | 0 | 1 |

Weekly sampled findings were 2 current + 9 historical missing-paid-evidence alerts, the same 98 odds alerts, 2 historical duplicates, 5 historical price gaps, 2 manual settlement queues and 1 compound settlement queue. These are sampled counts, not whole-database totals.

## Paid publication evidence

All four daily critical alerts are **legacy publication evidence gaps incorrectly treated as current-policy violations**. Their provenance marks a dedicated paid workflow but does not establish which evidence policy existed at publication. All predate Sprint 04's introduction on master: PR #178, merged **2026-11-13 21:02:29 UTC**, merge `5f4c36f66094cbcb1520f67e0b004316bcdffe47`. This earliest-master-introduction timestamp is a conservative diagnostic boundary, not a change to publishing rules or a claim about the exact deployment instant. Missing/invalid publication timestamps and dedicated paid publications at/after that boundary remain subject to critical missing-evidence diagnostics.

The four cases, labeled without exposing selections or IDs (all times UTC):

| Fixture-day period | Primary category | Provenance/tier | Published | Stored kickoff | Promotion quote fetched |
|---|---|---|---|---|---|
| Historical | VIP | VIP_GENERATED | Nov 11 23:20:37.956 | Nov 13 19:45 | Nov 11 22:15:03.750 |
| Historical | VIP | PREMIUM_GENERATED | Nov 11 23:35:24.691 | Nov 13 19:45 | Nov 11 22:15:05.279 |
| Current | VIP | PREMIUM_GENERATED | Nov 12 23:35:18.954 | Nov 14 19:45 | Nov 12 22:10:05.925 |
| Current | VIP | VIP_GENERATED | Nov 13 00:05:23.470 | Nov 14 19:45 | Nov 12 22:15:03.620 |

Each confirmation has legacy promotion fields (`tier`, market/probability metadata, bookmaker count, `quoteFetchedAt`, `confirmedAt`), with confirmation immediately before publication. None has `publicationQuoteEvidence`, named source attribution in a publication snapshot, or a verified publication entry-price basis. Promotion timestamps are authentic stored metadata; they do **not** prove an executable price at publication. Their presence cannot substitute for immutable publication evidence.

All four have `updatedAt > publishedAt`; this establishes later record modification but does not establish that a snapshot was removed or which field changed. No historical mutation audit proves evidence removal. The same applies to all 11 dedicated paid evidence gaps in the weekly sample: every publication predates the policy boundary (Oct 28 through Nov 13 00:05 UTC). The separate original historical INFO price gap remains an unavailable-evidence case, not a new critical publishing defect.

Correction: retain all four as INFO `PAID_PRICE_EVIDENCE_UNAVAILABLE`; critical current-policy checks remain intact. **No current atomic-publication defect was established by these records.** No historical quote fabrication, snapshot reconstruction, repricing or price backfill is justified. Premium provenance on a VIP primary category is reported faithfully; it is not proof of an entitlement error, and no tier links or access rules are altered.

## Odds findings

All **98** affected rows are PUBLISHED with stored future kickoff; none is archived or missing `fixtureApiId`. **96 are free and 2 carry paid category links.** All 98 lack a matching native `Fixture` cache row. Consequently "upcoming" here means the stored prediction schedule; actual provider fixture status, rescheduling and cancellations are **unverified**, not inferred from absent cache data.

| Market | Rows |
|---|---:|
| Double Chance | 38 |
| Over/Under | 27 |
| Both Teams Score | 12 |
| Same Game Double | 12 |
| Team Total | 8 |
| Draw No Bet | 1 |

Competition API IDs/counts: **5:27, 36:3, 44:13, 82:12, 142:16, 239:6, 254:2, 399:19**. These are identifiers, not a claim that coverage is equal across competitions.

Cache inspection: **21 unsupported mappings**, **63 mapped markets present**, **14 mapped markets absent**. The unsupported group comprises 12 compounds, 8 team totals and 1 draw-no-bet. This cache stores a restricted bookmaker vocabulary; repeatedly refreshing it cannot add those unsupported markets. There are **16 recorded no-quotes responses**, **82 without a cache error**, and **zero observed transport/provider-error markers** in this set. No-quotes responses establish historical availability only, not current upstream availability.

Local cache age: **37 within 120 minutes, 45 older than 120 minutes, 16 without a successful fetch timestamp**. Provider timestamp age: **82 older than 120 minutes, 16 absent**. Thus a recent successful local fetch can still contain old provider timestamps; those must not be mistaken for a failed fetch. Generation timestamps span Nov 10 21:10:25.434 through Nov 13 22:55:27.159 UTC; publication timestamps span Nov 10 22:28:36.725 through Nov 14 02:09:14.621 UTC. None of these aggregates proves that a price was stale at publication.

The original classifier applied a blanket provider-age warning to every upcoming published market. The correction distinguishes unsupported markets, unavailable coverage, local fetch failures, actual cache-refresh needs and provider timestamps. It also follows the existing worker's once-successfully-outside-24-hours / refresh-inside-24-hours cadence, sharing the unchanged horizon constant. Display cache age is distinct from immutable point-in-time paid publication evidence. No publication admission guard or actual refresh cadence changes.

The final cadence-aware read-only verification completed at **2026-11-14 08:31:11.853 UTC / 09:31:11.853 WAT**, [run 43576068143](https://github.com/Voclain1/betgenius/actions/runs/43576068143), again with 234/234 daily records:

| Final diagnostic | Rows | Classification |
|---|---:|---|
| ODDS_DISTANT_CACHE_RETAINED | 36 | INFO: successfully fetched distant fixtures; refresh is deliberately deferred until inside 24 hours |
| ODDS_PROVIDER_TIMESTAMP_AGING | 28 | INFO: recent local fetch with older provider quote timestamp |
| ODDS_MARKET_UNSUPPORTED | 21 | INFO: outside the cache's supported market vocabulary |
| ODDS_COVERAGE_UNAVAILABLE | 13 | INFO: recorded quote/market coverage gap; live availability unverified |
| ODDS_REFRESH_DUE | 0 | No near-kickoff cache-refresh warning established in this sampled set |

An intermediate assessment at 08:24:36 UTC provisionally marked 36 rows refresh-due before comparing the existing worker cadence. All 36 are distant fixtures; the final result supersedes that intermediate classification. **All 98 original odds WARNING severities were false positives as refresh instructions at this snapshot**, although their ages and coverage gaps are real and remain visible. None is relabeled as fresh. There is no justification to spend 98 additional provider calls, change refresh cadence or replace publication prices.

Recent stored refresh jobs show useful maintenance (7 and 3 successful fixture refreshes) and a run with no quotes available, with `remaining: 0` and no budget exhaustion in these examples. This is evidence that refresh work is occurring, not proof that every affected fixture was eligible or successfully covered. Current cache refresh eligibility, native fixture-cache absence and upstream availability remain separate questions. No provider outage, stale-price admission defect or broken scheduler was established from these alerts alone.

## Generation and duplicate publication

The current empty-output success has **one matching prediction**; a separate historical ledger record found in the targeted query has **four**. The arrays are nullable in PostgreSQL: Prisma reads NULL as `[]`, while an `isEmpty: true` filter misses SQL NULL. The audit explicitly checks both NULL and cardinality zero.

Confirmed code defect: `selectQueuedCandidates` previously marked already-generated fixtures SUCCEEDED without recording the existing prediction IDs. The correction records authentic IDs with the success transition in one transaction, preserving the exact same existing-output exclusion. A state guard prevents overwriting a concurrent terminal state. It creates no additional prediction, changes no ranking/admission policy, and performs no API call. Historical missing links are not backfilled. Where an exact matching output is present in the dashboard sample, the alert becomes INFO `GENERATION_OUTPUT_LINKS_MISSING`; without sampled evidence it remains WARNING `SUCCESS_WITHOUT_PREDICTION_IDS` rather than assuming success.

The daily historical duplicate is **two distinct FEATURED / STANDARD_CURATED / DRAW_NO_BET rows**, created Nov 11 23:55:38.152/.153 UTC and published Nov 12 08:11:29.938/.945 UTC. It is a genuine duplicate stored selection, not one row carrying several categories. Retain WARNING and manual review. The close timestamps are consistent with a duplicate batch/retry but do not prove the original writer or cause; no historical transaction trace identifies it conclusively. Current generation uses the existing worker lease and coverage checks; publication uses existing conditional transactions. Existing concurrency/atomicity tests remain in place. No evidence supports changing live selection policies or adding a database-wide uniqueness rule that could invalidate legitimate category use.

The additional weekly overlap is an OVER_UNDER selection with a SAME_GAME_DOUBLE / STANDARD_CURATED leg and a separate GOALS / GOALS_GENERATED row (Nov 9). It may be legitimate category-specific reuse; it is not proof of a duplicate paid publication. Preserve the diagnostic for historical review. Neither case was deleted, unpublished or rewritten.

## Job classification and instrumentation

Stored payloads support the following distinctions; raw `detail`, reported `ok` flags and HTTP transport outcomes remain separately available:

- `refresh-insights`: target/insight/write/clear/fetch-failure counters distinguish successful cache maintenance from no targets and fetch failures. Zero writes with checked cached insights is not unknown and is not new content output.
- `notifications-reminders`: actual reminder/insight counters and recognized digest outcome strings distinguish new events, an existing digest, no eligible work, readiness deferral and unknown outcomes. Unknown strings remain UNKNOWN.
- `notifications-dispatch`: observed all-zero runs are NO_WORK; the observed 8 claimed / 8 retried / 0 delivered run is DEFERRED with retry failures retained, never a successful delivery. Partial output and lease-loss cases remain distinct.
- `email-dispatch`: nested send/queue/error counters distinguish useful sends/queueing, no due mail, retry deferral, failed producers/sends and partial failures. Unrecognized nested payment-sync outcomes remain UNKNOWN. The three inspected email runs had all-zero send/queue/error counts, supporting NO_WORK.
- `curate-accumulators`: actual tier outcomes support useful output (observed 5 and 3 created), already-present maintenance, and pool-gate/no-qualifying work (including six empty tiers with `attempted: false`). Malformed/unrecognized tiers remain UNKNOWN.
- `paystack-sync`: historical records have no structured counters and **remain UNKNOWN**, regardless of `ok: true` or human summary text. Future successful runs now retain `{ ran: true, recorded }` as instrumentation. Payment synchronization and entitlements themselves are unchanged.

These are diagnostic improvements; no new notifications, payments, selections or job executions were initiated by the investigation.

## Validation and release recommendation

All **31 local suites passed**: odds integrity; operations investigation; prediction operations; results pass; period predictions; notification targeting; admin jobs; paid market quality (its component suites); league coverage quality; paid value integration; VIP/PREMIUM overlay; goals generation; adaptive coverage; subscription entitlement; Paystack entitlement; one-time fallback; prediction reliability; paid subscriber; paid rendering; bulk-generation dedupe; notification digests; enrichment reporting; accumulators; payment observability; payment reliability; and six disposable PostgreSQL suites (prediction operations, paid publication, reliability, current-mode reliability, operations investigation, odds integrity).

New regressions cover legacy/current/missing/valid evidence for both VIP and PREMIUM; missing/stale/unsupported quotes; provider failures; ended/archived/active fixtures; distant-cache cadence; invalid provider timestamps; known/unknown job shapes; actual concurrent/repeated generation retries and nullable output links; unchanged published records; and PostgreSQL rejection of writes inside a read-only transaction. Existing integration tests cover atomic paid publication/rollback/notification idempotency and immutable Sprint 06 current-mode snapshots, selected/rejected candidates, empty sets, retries and observer failures. TypeScript passes. No production database is used for mutation tests; the PostgreSQL service is disposable and local.

`check:odds-integrity` now passes **59** assertions, alongside 82 operations-investigation and 73 prediction-operations assertions. The PostgreSQL guard test observes SQLSTATE 25006 when attempting a disposable write inside a read-only transaction. GitHub Actions runs the new pure and PostgreSQL tests in the existing `prediction-operations` workflow. Required PR checks cover operations, reliability, paid-market unit and publication integration, league quality, preflight/build, and the read-only evidence audit; the manual-only operations-investigation job is intentionally skipped on PR events. Final check results and the immutable delivery SHA are recorded with the PR delivery, without a self-referential SHA in this document.

Across the original daily findings, **4 critical applicability false positives and 98 odds-refresh warning false positives** are corrected; **1 confirmed generation bookkeeping defect** is fixed for future runs; **1 genuine historical duplicate selection** remains for review; and **1 existing historical unavailable-price INFO** remains informational. This is not a whole-database assertion: unknown payment outcomes, unverified live fixture/provider state and historical prices remain unresolved.

**Recommendation:** review this diagnostic/bookkeeping PR for merge once required CI is green. This is not approval to merge or deploy, and no release or recovery was activated. Historical evidence cannot be repaired from current prices. The duplicate remains a historical review item. Before any separately authorized production release, inspect the current-policy critical alerts, verify any genuine near-kickoff cache backlog against the existing refresh scope/backoff and provider availability, and confirm new generation successes retain IDs and future payment-sync reports contain counters. If fixture schedule verification is needed, use the existing bounded read-only provider probe; do not infer a cancellation or refresh failure from missing native Fixture rows.

The final PR head SHA is recorded in PR #183 and the delivery message; workflow links above bind each production observation to its audited commit. A passing branch audit predicts diagnostic behavior against live stored data, not that undeployed production UI code has already changed.
