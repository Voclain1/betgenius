# Paid supply reliability and experiment readiness — 16 November 2026

**Activation NO-GO.** This change fixes identity counting and adds diagnostics. It does not enable the experiment, change prediction standards or demonstrate increased supply. Production observations below are timestamped evidence, not a prediction of tonight's eligibility.

## Verified causes

Read-only [investigation run 43846299316](https://github.com/Voclain1/betgenius/actions/runs/43846299316), snapshot 11:28:39 Africa/Lagos on 16 November, is archived in [redacted evidence](paid-supply-investigation.json).

* November 17 had **8 paid attempt records but only 7 unique fixture IDs**. Previously the richness gate added raw records to candidate counts, allowing seven used identities plus two eligible identities to appear to reach ten. Both selection and serialized extra-attempt reservation now require ten distinct used-plus-eligible fixtures, with at least one eligible unattempted fixture. Overlaps and missing IDs cannot inflate richness. Monetary/attempt accounting still charges every paid call.
* Fixture **1545903**: scheduled job `cmwi6wj570cuhpthsx1gs5sqd` at 19:50:31 Lagos on November 15 was rejected with `CertaintyLanguageError`, producing no prediction. A different administrator explicitly retried the saved failure at 19:58:05 using the established manual-retry route (`cmwi769ms0cwlpthscezhp4n9`). That completed with two ordinary `STANDARD_CURATED` predictions, published at 19:59:30. This was a legitimate separate paid manual call, not a second scheduled reservation or experimental request. Audit history is retained; no retry behavior is changed or ordinary prediction automatically promoted.
* The investigated **20 missing/stale quotes comprised 19 stale cached payloads and one empty bookmaker response** (fixture 1628598, `NO_BOOKMAKER_PRICES`). All 20 kickoffs were more than 24 hours away at the snapshot. None was due for the existing paid warming pass. There was no confirmed provider, warming or backoff defect to repair in this sample. The two-hour freshness, 24-hour warming window, 60-minute failed-fetch backoff and 12-call warm cap remain unchanged.
* At that snapshot, 31 covered fixtures produced 20 in-scope candidates, 20 quote failures and **zero currently eligible targets**. No fresh dedicated publication timestamp existed after PR #202's deployment, across any prediction status. The manual retry's ordinary publications are not dedicated publication proof. The observed absence is explained before generation by the candidate/quote funnel; no publication-path defect was established. Existing atomic publication tests still cover stale quotes, kickoff, duplicate transitions and notifications. New outcome telemetry separates no qualifying draft, requote, publication safety hold and generation failure.

The historical four quota-blocked fixtures were unique IDs **1545900, 1528986, 1545890 and 1545888**, all kicking off November 16. At the November 15 reference cycle, eight unique used fixtures plus these four gave a genuine pool of twelve. By the morning investigation these were inside the 12-hour generation cutoff; they cannot support a future activation window. High stale favourite probabilities are not eligibility evidence; favourites above 86.96% remain discoverable because alternative markets may qualify.

## Changes and limits

`fixtureRichnessByDay` deduplicates identities within each kickoff day and removes candidates already used on any day. `reserveExtraAttempt` re-reads attempts and orphan reservations under the existing advisory lock and rechecks the identity proof. All existing fixture-history, daily creation, API and spending guards remain in force. No schema change, historical deletion, provider routing change or reviewed SQL hash-guard modification is included.

Readiness telemetry reports raw records separately from distinct identities. Odds diagnostics count every candidate but bound samples to 20, with allowlisted provider-failure categories instead of raw errors. Warming decisions use one shared policy; 180 differential boundary cases compare it against the previous predicate. Diagnostics do not refresh odds or authorize generation.

## Repeatable read-only readiness procedure

Dispatch `sprint11-production-audit.yml` on the reviewed branch with **only** `paid_supply_readiness_only=true`. Optionally supply `paid_supply_expected_commit` and the correct `paid_supply_deployed_at` timestamp. Leave all repair/backup-creation modes false. This mode excludes every other workflow job, probes an allowlist of running application settings, verifies the database name `betgenius`, forces transaction read-only at connection and transaction levels, and reads cached eligibility in one repeatable-read transaction. It makes no provider calls and no production writes. Failures withhold raw error values.

Inspect unique fixture IDs and kickoff days, fresh eligible candidates, publication timestamps across all statuses, API headroom, creation-day charges and price settings. Revalidate immediately before proposing any experiment: odds, kickoff cutoffs and quotas can change. A snapshot cannot reserve future supply or guarantee a promotion. The audit's publication-count and before-kickoff checks supplement, rather than replace, the existing publication-integrity audit/tests.

## Backup prerequisite

Complete: unattended `betgenius-2026-11-16T0230Z.dump`, created **03:30 Lagos**, 30,485,126 bytes, SHA-256 `3a297d476f47bfeb908059fe12466ffc2aaffb65073ff8501156aeda17057aa6`. [Configuration/authenticated storage verification](https://github.com/Voclain1/betgenius/actions/runs/43795490144) and [isolated PostgreSQL 17 recovery](https://github.com/Voclain1/betgenius/actions/runs/43795490437) passed. Recovery covered 43 tables, matching schema definitions, representative data and zero invalid indexes/unvalidated constraints. No new backup was created by this sprint.

## Price attestation and secret-safe configuration

Production snapshot: experiment flag and all incremental pricing/budget settings **unset**. The configured/default route was Anthropic `claude-haiku-5-5`; key presence was checked as a boolean, never exposed. No active price attestation existed, so permitted extra attempts were **zero**.

[Anthropic's official price table](https://platform.claude.com/docs/en/about-claude/pricing.md), retrieved November 16 at 10:56 Lagos (HTTP 200; content SHA-256 `048ccb65c7aa39a16f8475d92bec1730bc9e42c63b79085e2f0f1e6e5f867cd1`), listed standard synchronous Haiku 5.5 rates of $0.10/$0.50 per million input/output tokens through 100k input, and **$0.50/$2.50 above 100k input**. Recheck provider pricing before approval; do not use discounts, the lower tier or historical average prompt size for the full-context reservation. At 200,000 input and 16,000 output tokens, conservative reservation is **$0.14 per request**. Earlier simulation's $0.028 was illustrative and is not a current production attestation.

After separate configuration/deployment approval, use the existing VPS/application environment and GitHub secret synchronization procedure. Do not paste env files or credentials into logs, PRs or chat; preserve the existing Anthropic key. Stage these non-secret policy values with the switch **off**:

| Setting | Proposed value, only after owner approval |
|---|---|
| `VIP_QUOTA_EXPERIMENT` | `off` during configuration, deployment and verification |
| `VIP_QUOTA_EXTRA_ATTEMPTS` | `2` |
| `VIP_QUOTA_INCREMENTAL_DAILY_USD` | `0.30` |
| `VIP_QUOTA_INPUT_USD_PER_MILLION` | `0.50`, after confirming current upper-tier price |
| `VIP_QUOTA_OUTPUT_USD_PER_MILLION` | `2.50`, after confirming current upper-tier price |
| `VIP_QUOTA_PRICE_VALID_UNTIL` | Explicit approved ISO timestamp with timezone, future and at most 31 days away; preferably the end of the single test window |

No environment values are applied by this PR. Missing/expired prices fail closed. Deployment verification must compare incoming and running settings without printing secrets. Run the new read-only audit to verify the actual model, rates, expiry and $0.14 reservation before separate activation approval. Do not infer invalid pricing solely from `activeExperimentConfigValid=false` while the flag is off: that configuration intentionally returns null when disabled; inspect the displayed allowlisted settings too.

## Readiness decision and rollback

**No future eligible kickoff day has yet been established by a fresh identity-correct snapshot.** Outstanding prerequisites are a current ten-unique-fixture pool with fresh eligible unattempted targets, successful post-deployment dedicated publication, and an approved valid pricing/budget attestation. The implementation also requires review, green CI and separate deployment approval. Backups are complete, not an activation blocker.

If those prerequisites subsequently pass, propose one Lagos creation-day window, at most two extras, $0.30 incremental funding, $0.28 fully reserved maximum for two requests, and never beyond approved price expiry. The permitted count is the minimum of two, eligible unique unattempted targets, kickoff-day allowance remaining, creation-day 12-call headroom, funded reservations remaining and existing API safety headroom. API consumption varies by fixture, so a nonzero API balance alone cannot prove a precise request capacity; existing per-call ceilings must still pass.

Automatic guards block new extras for invalid/expired pricing, unsupported routing/model, missing reliable usage, spent budget, duplicate identity, failed richness or exhausted quota/API headroom. Publication retains its own stale-quote/kickoff/integrity gates. An operator must stop the experiment on publication anomalies or operational regressions; this PR does not invent an automatic aggregate success-monitor. Evaluate actual incremental qualifying promotions and cost per promotion, recording zero promotions honestly; retain international-break and fixture-rich cohorts separately and await settlement/calibration.

Rollback: set only the experiment switch `off` using the approved configuration procedure. Retain charged reservations and audit records; do not refund unknown costs or delete data. Existing rollback-aware publication checks hold experimental drafts. If code rollback is needed, revert this focused PR through normal review/deployment approval; no database rollback is required. No demonstrated supply increase is claimed: counting is more conservative and diagnostics explain why supply is absent.

## Validation

Local: TypeScript, 248 overlay checks, 23 quota checks, 64 spare-quota checks, 75 paid-selection checks, paid-market/entry-evidence/integrity/holdout suites, 72 qualification-research checks, 110 European-club checks, experiment costing/transport checks, and the new identity/redaction/180 warming boundary/publication-outcome checks pass. Disposable PostgreSQL 17 tests pass concurrent duplicate/budget reservations, unknown-cost fail-closed behavior, no refunds, API 7,500 ceiling, creation-day 12-call cap and publication/notification rollback safeguards. CI repeats these against PostgreSQL 16 and 17. CI and the final fresh audit results are recorded in the PR; they must not be assumed green until complete.
