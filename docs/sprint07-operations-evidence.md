# Sprint 07 — prediction operations reliability

## Release scope and evidence

Base: latest master `4c51a37300a4dce5f2587a3b8a836a380f222b9b`.
GitHub confirms Sprint 06 #180 merged on 14 November 2026; its final current-mode
snapshot correction is included. Branch: `sprint-07-operations`.

All new operational evidence here is code inspection, synthetic fixtures, or
local disposable PostgreSQL. No production data, provider result, timing,
scheduler configuration or credential was changed during development. This is
not a fresh production incident/performance audit; production frequency, backlog
sizes and SLA compliance cannot be inferred from this checkout.

## Architecture and schedules actually available

| Stage | Existing implementation | Existing safeguards / dependencies |
|---|---|---|
| Discovery | `generation/queue.ts`, competition registry | Coverage modes, hourly sweep lease, versioned competition eligibility and bounded evaluation lane |
| Generation | `generation/worker.ts`, `ai/generate.ts`, dedicated Goals/VIP/European/BOTD lanes | AppLock holder lease (ordinary worker: six minutes), unique GenerationAttempt.matchKey, recorded output ids, bounded attempts/backoff, ABANDONED terminal state, provider quota reserve |
| Enrichment/prices | `enrichment.ts`, API-Football client, detail/team/odds caches | Cron writers; readers reuse caches, local fetch timestamps and provider odds update are distinct |
| Selection/review | `geniusCuration.ts`, admin single/bulk prediction routes | Existing tier admission, ranking, protected picks, review actions, kickoff veto; no new selection policy |
| Publication | `predictions.ts`, `goalsPipeline.ts`, `vipPremiumPipeline.ts` | Shared review helper, gated Goals auto-publish, Sprint 04 atomic paid quote/event transaction |
| Kickoff monitoring | `kickoffReconcile.ts`, settlement | Existing authoritative id-based reschedule handling; no change to schedule or public content |
| Settlement | `settlement.ts`, `settleFinished.ts`, same-game double settlement | Regulation-time evidence, team orientation, final statuses, conditional PENDING update, transactional result notification |
| Results/reporting | results pass, track record, paid operations, Sprint 06 snapshots | Existing category/entitlement filtering and immutable research decisions |
| Notifications | notification outbox/dispatch | Unique event keys, delivery leases/retries; not replaced by this sprint |

Checked-in schedules (both `vercel.json` and `deploy/ops/crontab`):

- Settlement: 06:00 UTC / 07:00 WAT daily.
- Accumulator curation: 10:30 UTC / 11:30 WAT daily.
- VPS backup only: 02:30 UTC / 03:30 WAT daily.

These two scheduler definitions are alternatives for their hosting platforms,
not evidence that both are active. Comments say cron-job.org additionally calls
public endpoints, including a three-hour settlement cadence and notification
requests every two minutes. **Those external settings are not in the repository
and were not verified.** Do not invent a next expected runtime or silently edit
these schedules. The operations page labels external scheduling unverified.
The results pass executes inside notification dispatch, leased to at most once
per ten minutes, limit 25. Coverage's evaluation lane has its own three-hour
lease. Existing generation and provider quota controls remain authoritative.

## Verified weaknesses and corrections

1. **HTTP success was conflated with completion.** `recordRouteRun` set ok from
   status alone; `withJobRun` recorded any returned result as ok. Preserve this
   transport indicator for compatibility, but append `operationalCompletion`
   with USEFUL_OUTPUT, NO_WORK, PARTIAL_FAILURE, FAILED or UNKNOWN, plus known
   counts. Counts are recognized only from explicit numeric output/failure
   fields or structured settlement failures. Unknown payloads stay unknown;
   a quiet job is not automatically broken and a 200 is not useful-output proof.
2. **Provider outage looked like a missing fixture.** Null responses and empty
   fixture results were conflated in the date path; a failed prefetch could
   cause duplicate per-row id/date requests. Preserve batch-unavailable state,
   distinguish `provider_unavailable`, skip redundant lookups, and do not spend
   fixture retry attempts on an outage. Successful batches missing an id remain
   explicit not-found evidence. Odds and fixture HTTP fetches now have 15-second
   abort timeouts and null failure results, retaining quota/throttle accounting.
3. **Concurrent review could publish twice.** The shared review helper reread
   kickoff outside its write transaction. Add a conditional row claim and locked
   reread before publication, preserving reviewTransition/notification logic.
   Repeated publication of an already-published row emits no new event. Approval
   cannot turn an already-published row back into APPROVED.
4. **A future stored kickoff could hide a completed/rescheduled fixture.** Shared
   review, paid atomic publication and single-row review now veto known live,
   final, cancelled, abandoned, postponed or suspended native fixture statuses,
   schedule disagreement and invalid structured selections. Native fixture data
   is a veto, never a fabricated confirmation. Missing native data remains
   unknown: legacy manual predictions are not globally disabled. Existing paid
   pricing/selection/lead-time gates and append-only evidence are preserved.
5. **Settlement could use an edited market snapshot.** Strengthen conditional
   settlement and maintenance writes with the original updatedAt and PENDING
   outcome. A concurrent edit/settlement wins instead of being overwritten.
   An authoritative kickoff correction adopts only the returned version from
   its own conditional update before proceeding; a reschedule can settle in
   the same pass. Ordinary/global and results-pass entry points retain their
   existing defaults. Authorized recovery can scope settlement to one id without
   scanning hidden compound legs or changing other predictions.
6. **Automatic settlement lacked a frozen source record.** In the same existing
   transaction as outcome and notification, append `settlementEvidence` alongside
   market confirmation: source, matching method, regulation/half-time score,
   provider kickoff, observed time, market and selection. Publication quote
   evidence is retained. Already-settled rows are never re-settled automatically.
7. **Manual corrections lacked an explicit reason/history.** Changing a settled
   outcome or score now requires an eight-character correction reason. The
   transaction records actor, reason, before/after scores/outcome and old evidence
   in a settlement-correction JobRun. Same-result requests replay without new
   corrections/events. Category writes and edited fields now share the same optimistic transaction, so failures roll both back. A concurrent state change returns 409. Admin settlement
   controls collect the reason; public UI is unchanged.
8. **Operational evidence was split across tools.** Add the bounded, admin-only
   prediction operations view and read-only reconciliation described below.

No claim is made that every legacy prediction has fixture identity, historical
prices, or complete publication evidence. Existing paid category rules and
subscriber-access behavior are not relaxed to make diagnostics look healthy.

## Read-only monitoring and reconciliation

Files: `predictionOperations.ts`, `operationsData.ts` and
`/admin/prediction-ops`. Existing `/admin/jobs` and `/admin/paid-ops` are retained.
The page explicitly authenticates administrators as well as using admin layout.

Filters: one/seven-day lookback, competition id, category and severity. The
prediction cohort includes the chosen lookback and the next 72 hours; this is
shown in the UI. Up to 500 predictions, 500 native fixtures/odds/detail caches,
1,000 team caches, 100 recovery records, 100 generation ledger records, 50
expired leases and 50 failed delivery records. Per-job history is capped at 100
runs per job, so busy jobs cannot erase quieter jobs from the sample. Truncation
is visible. Reconciliation is not a whole-database health guarantee.

Sprint 06 observations are looked up by the deterministic VIP/PREMIUM record ids
for the selected prediction universe (at most 1,000 keys), rather than the last
1,000 global records. Missing observations are INFO, because dedicated,
sub-floor, pre-snapshot or expired records can legitimately be outside that
research universe. No snapshot is rewritten or reconstructed from later data.

The read path runs in an explicitly READ ONLY transaction, max 10 seconds,
max pool wait 1 second, per-statement timeout 3 seconds. There are roughly 25
bounded/index-assisted reads (eight base groups plus the known-job groups), no
provider polling. A small synthetic disposable-DB run took 12–15 ms; that is
not a production p95 or a benchmark at the row caps.

Findings include: late or missing publication times, absent paid quote evidence,
missing primary paid/category links, duplicate fixture/selection, changed kickoff,
final-but-pending fixtures, settlement delays, premature timestamps, FT score
discrepancies, missed review/generation windows, successful ledger rows without
recorded output ids, missing research observations and stale/missing odds.
High-risk findings are manual review only. No automatic approval, publication,
entitlement repair, category relinking or historical outcome correction exists.
Native FK constraints continue to prevent relational orphans; the bounded view
does not claim a global audit of every polymorphic historical reference.

Freshness states: FRESH, AGING (>75% of threshold), STALE, MISSING,
PROVIDER_UNAVAILABLE and UNKNOWN (unsupported/invalid/future clock).
Defaults, in minutes: fixture 180, odds 120, enrichment 1440, generation 2880,
publication evidence 120, settlement diagnostic budget 360. Override via
`OPS_FRESHNESS_<SOURCE>_MINUTES`, bounded to 1–10080. Missing never means fresh.
Both local odds fetch and provider update are assessed; refreshing an unchanged
old provider quote cannot make it current. Publication quote age is evaluated
at publication, preserving point-in-time evidence. Venue/detail and both team
enrichment caches are reported separately. Unknown/missing native fixture status
cannot establish that an upcoming match is still pre-match.

### Metric definitions and limits

| Metric | Numerator / denominator | Window / limits |
|---|---|---|
| Transport success | ok records / observed job runs | 1 or 7 days, per-job cap 100 |
| Useful output completion | recognized USEFUL_OUTPUT records / observed runs | Same; UNKNOWN and legitimate NO_WORK are separate |
| Operational failure | recognized FAILED/PARTIAL_FAILURE runs / observed runs | Same; not an API error-rate estimate |
| Publication timeliness | late publication records / records published in the window | Bounded kickoff cohort; publish time compared to kickoff |
| Odds freshness | FRESH upcoming published rows / upcoming published rows | Sampled upcoming 72 hours; missing prices remain denominator |
| Settlement latency | settledAt minus kickoff, in minutes, for recorded settlements | Settlements within lookback and cohort; final-whistle latency unavailable |
| Correctness exceptions | recorded FT discrepancies in the sample | Diagnostic count, not a measured error rate over every settled tip |
| Recovery success | successful completed operations-attempt rows / completed attempt rows | Lookback and recovery record cap; receipt rows not double-counted |
| Retry success | same, restricted to attempt >1 | Same; interrupted attempts remain explicit |
| Queue backlog | sampled PENDING/FAILED/ABANDONED generation rows | Ledger list also includes success evidence; capped 100 |
| Duplicate prevention | existing curation/ledger/event constraints; test evidence | No invented aggregate prevention rate |
| Provider API error rate | unavailable/null | Usage counts alone lack a durable full response-status denominator |

Daily/weekly summaries use these same definitions. No new email destination or
alert credentials are created; existing paid-ops alerts remain unchanged.

## Recovery controls and execution protocol

`operationExecution.ts` reuses AppLock and JobRun, not a second scheduler.
Only two closed operations exist in `operationsRecovery.ts`:

- REFRESH_ODDS: published prediction, verified fixture id/key, >=60 minutes to
  kickoff, local or provider quote not fresh. Uses the existing odds writer and budget gate;
  it never edits the published pick, selection or publication reference quote.
- RETRY_SETTLEMENT: one published, pending, auto-settle-supported prediction,
  verified provider id, >=110 minutes past kickoff. Reuses the authoritative
  settlement resolver. Human-review-required, already-settled and unsupported
  markets are not bypassed; existing manual flags remain authoritative.

Default: `OPS_RECOVERY_MODE` unset, so only previews run. Setting it to `manual`
is a separately authorized operational rollout step, not performed here. The
POST endpoint requires ADMIN/SUPER_ADMIN session, the existing proxy-aware
mutation-origin check, valid action/id/reason, matching same-hour preview key,
and explicit authorization for the published cache/outcome evaluation. The
client presents the preview and a separate authorization checkbox. Previewing
is read-only and contacts no provider. It does not persist an audit row; retain
its returned plan if a preview-only review record is needed.

Execution identity is deterministic per action/target/hour, independent of
retry request ids. A resource lease excludes overlapping operations on the same
action/target across hour boundaries. Lease expiry: five minutes; route budget:
120 seconds; HTTP fetch timeout: 15 seconds. A holder only releases its own
lease. Existing scheduled-worker/provider throttles still apply.

Execution receipt plus immutable attempt records contain actor, reason, state,
attempt, result, duration and next retry time. Three attempts maximum per key;
5s/10s/20s exponential delays plus deterministic <1s jitter, capped 60s base.
Retries are explicit calls, not a new background loop. An interrupted RUNNING
attempt becomes INTERRUPTED on expired-lease recovery; the previous history is
kept. SUCCEEDED replays without running the handler. Failure/backoff, BUSY and
TERMINAL are distinct; a lease lost at completion leaves an unconfirmed record
rather than claiming success. Side effects are idempotent cache writes or
conditional pending settlement, never automatic publication. Dependencies are
revalidated after claiming the lease; recovery odds writes also verify and lock
the resource lease inside their cache-write transaction. Normal scheduled odds
writers retain their original path without additional lease reads. A database failure before the claim runs
no handler; partial side effects are inspected before retrying.

Compensation: odds refresh requires no prediction rollback because frozen
publication evidence is untouched. Settled results require the explicit,
reasoned administrative correction workflow; no automatic undo is offered.
No cache/settlement request can alter subscription entitlements. Generation
retry and notification recovery continue through their existing versioned
workers/leases. Generic force-requeue, force-publish, resending notifications,
or resetting another worker's active lease are intentionally not exposed.

## Verification and reproduction

```sh
npm ci
npm run check:prediction-operations
npm run check:results-pass
npm run check:period-predictions
npm run check:notification-targeting
npm run check:admin-jobs
npm run check:paid-market-quality
npm run check:league-coverage-quality
npm run check:paid-value-integration
npm run check:vip-premium-overlay
npm run check:goals-generation
npm run check:adaptive-coverage
npx tsc --noEmit
```

New pure suite: 75 synthetic checks. New real PostgreSQL suite covers concurrent
lease claims, expired/held leases, interrupted attempts, duplicate retries,
backoff/terminal state, DB failure, publication races and known-final vetoes,
atomic score/evidence/event settlement, incomplete/postponed/abandoned/suspended/
cancelled fixtures, reschedules, provider outages without retry exhaustion,
corrected-result discrepancies, reasoned correction audits/replay, actual
pending-settlement recovery/replay, authorization/origin rejection and bounded
read-only diagnostics with zero provider calls.

The existing results-pass source assertion is updated to require the stronger
PENDING **and updatedAt** guard. It was not removed or weakened.
Fifteen targeted existing suites pass locally, including Sprint 04/05, paid
subscriber/render, subscription, Paystack and one-time entitlement safeguards.
Earlier full targeted pass also covered confidence and kickoff assertions.

`prediction-operations.yml` runs new pure/PG checks, TypeScript and the relevant
existing suites, then the original atomic publication, immutable snapshots and
current-mode VIP/PREMIUM PostgreSQL suites. All database writes in these tests
are guarded to the disposable local CI database. No production test writes or
manual production migrations were executed. Actual CI results belong to this
PR's final SHA, not to the previous sprint's green checks.

## Database/API cost, rollout and rollback

No schema change, migration or new index is required. Existing JobRun primary
key/job-time index, AppLock key/expiry index and prediction/cache keys are reused.
The diagnostics cohort may still use a bounded sort over kickoff/status data;
measure production plans/latency before increasing caps. Diagnostic reads do not
consume provider quota. Recovery makes <=1 odds request or one fixture-id request
per action (existing quota accounting and reserves apply). A failed batch no
longer triggers redundant per-row id/date calls. Scheduled frequencies, coverage,
VIP/PREMIUM quotas, confidence/calibration flags and publishing schedules remain
unchanged.

Storage: completed receipt plus <=3 attempt rows per action/target/hour, small
bounded handler results. At 20 operations/day and roughly 2–4 KiB/record, plan
about 15–60 MiB/year before indexes/WAL and correction audit payloads. This is
an estimate, not measured production growth. Historical correction/attempt
records are not automatically deleted; archive via the owner's existing audit
retention policy. Ordinary auto-settlement appends one small evidence object
inside the existing prediction JSON; it does not grow on polling retries.

Rollout order:

1. Review code, audit and passing CI. No merge/deploy performed by this task.
2. Deploy read-only diagnostics and default-disabled recovery, through the
   owner's existing release process. No table prerequisite or cron change.
3. Review daily/weekly findings and preview only; verify the external scheduler
   independently and establish a runtime baseline before claiming SLA compliance.
4. Only after explicit operational approval, set OPS_RECOVERY_MODE=manual and
   authorize individual reviewed actions. Do not enable automatic recovery.
5. Any future scheduler, generic repair or automatic recovery needs separate
   reviewed changes; no environment flag activates a new selection policy.

Rollback: unset OPS_RECOVERY_MODE first. Revert the sprint commit if necessary;
leave JobRun audit rows and existing settlement/publication evidence intact.
No destructive migration or audit deletion is needed. Already-settled results
must be corrected explicitly, never reverted by deleting their provenance.

Remaining limits: no verified live scheduler inventory/production SLA sample,
no full provider result-correction poller, incomplete native fixture coverage,
legacy/manual identities and prices may be unknown, no automatic high-risk
repair, no global historical orphan scan, and no measured full API error-rate
denominator. A lost response after a side effect can leave RUNNING until lease
expiry; inspect the receipt/underlying cache or settled prediction before retry.
These are visible limits, not green indicators or invented success claims.

Recommendation: review as a default-disabled recovery/diagnostics release;
require passing final PR CI and normal owner approval before merging/deploying.
No unvalidated prediction policy is eligible for activation.


### Additional baseline check

`check:goals-category` retains one unrelated failure: “GOALS feed re-filters and
keeps display ordering”. It reproduces on untouched master `4c51a37`. Two source
assertions were updated to require the new transaction client/atomic category
write; the unrelated failing assertion was not changed. This is separate from
the fifteen passing targeted release suites and must not be hidden by green CI.
