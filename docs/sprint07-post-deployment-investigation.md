# Sprint 07 post-deployment investigation

## Decision

A focused corrective PR is justified by verified dashboard/instrumentation
misclassifications. **Do not force-settle old predictions, weaken generation
filters, reopen manual outcomes, or enable recovery.** The evidence does not
show a stuck automatic settlement queue at the inspected times.

Base: `dd5bec8edf56041990b6e3e4ff4240c38f8f25cb`, latest master after #181.
GitHub confirms #181 merged and the matching VPS deployment workflow succeeded
([deployment run](https://github.com/Voclain1/betgenius/actions/runs/43541240870)).
This is deployment-workflow evidence, not an independent attestation of every
runtime setting. No production record, cron, credential or recovery flag was
changed by this investigation. Local tests are not production health evidence.

## Production observations, safely obtained

The repository already had an authorized VPS tunnel, production database
secrets, read-only diagnostic workflows and a masked provider-key mechanism.
No credentials were available locally or downloaded. The existing audit workflow
now has a separate manually selected `operations` scope. It uses a direct Prisma
client and checks `SHOW transaction_read_only = on` inside its repeatable-read
snapshot, with timeouts. It does not import application job/usage writers.
Outputs contain aggregate counts, numeric payload shapes and fixed reason
categories, not prediction ids, match names, selections, analysis, raw errors,
subscriber records or credentials.

Evidence runs:

- [43545223856](https://github.com/Voclain1/betgenius/actions/runs/43545223856):
  14 November, **03:16 WAT**. Database-enforced read-only snapshot and bounded
  live provider verification. Four GET requests, 71 unique fixture ids requested,
  69 returned, no reported HTTP/provider/subscription errors.
- [43545694337](https://github.com/Voclain1/betgenius/actions/runs/43545694337):
  **03:20 WAT**. Read-only cohort/compound dependency follow-up, zero provider calls.
- [43547169240](https://github.com/Voclain1/betgenius/actions/runs/43547169240):
  **03:36 WAT**. Read-only comparison of original and corrected classification
  on stored job payloads, zero provider calls. This executes the new pure
  classifier against existing records; it does not rewrite them or deploy code.
- [43547578169](https://github.com/Voclain1/betgenius/actions/runs/43547578169):
  **03:41 WAT**. Read-only redacted failure-category follow-up, zero provider
  calls; eligible published singles and hidden legs were still zero.

Each run is a dated observation. Live activity may change between snapshots;
counts below are not a perpetual SLA guarantee.

## Settlement: the warnings were not the engine's eligible backlog

At the 03:20 WAT snapshot:

| Population | Verified count / meaning |
|---|---|
| Published pending >360 minutes after stored kickoff | 106, all older than the previous 24 hours |
| Manual-only published records in that population | 91 |
| Non-manual compounds | 14 |
| Remaining non-manual single | 1, ineligible because required league/name metadata is missing |
| Published singles meeting the engine's ordinary eligibility predicate (>110 minutes) | **0** |
| Hidden legs of published compounds meeting that predicate | **0** |
| Predictions settled during preceding 24 hours | 59 |
| Native Fixture cache coverage for the 106 records | 0; absent native rows cannot verify live status |

Thus **zero currently eligible singles/hidden legs** was verifiable. This does
not mean there is no historical manual work: confirmed-final manual records and
compound dependencies remain unresolved. Do not call the whole 106-record age
population a verified overdue automatic backlog.

### Exact dashboard reproduction

The original dashboard loaded every prediction state in the kickoff window, but
`reconcilePredictions` emitted SETTLEMENT_DELAY for **any** PENDING prediction
older than the threshold. It required neither PUBLISHED state nor a final
fixture, and did not exclude manual/compound queues.

| Original dashboard cohort | Cohort/sample | Age-only SETTLEMENT_DELAY findings |
|---|---|---|
| One-day lookback +72h upcoming | 231 /231, uncapped | **28; all 28 ARCHIVED**, none eligible for settlement |
| Seven-day lookback +72h upcoming | 805 /500, capped, oldest first | 42: 32 ARCHIVED, 10 PUBLISHED; 9 manual-only |

This directly explains the repeated warnings. Archived predictions are correctly
excluded by the settlement engine; their dashboard age flags were false
operational alarms. Already-settled WON/LOST/VOID rows cannot enter the original
PENDING check; no production example of an already-settled row wrongly counted
as a delay was established.

The seven-day query also selected oldest-first under a 500-row cap, so historical
rows could evict current/upcoming records. This is a separate confirmed sampling
defect, reproduced with more than 500 historical rows in PostgreSQL.

### Live provider breakdown of the 106 published records

These mutually exclusive categories classify the snapshot records using the
bounded GET probe. They are not inferred from kickoff age and not written back.

| Provider/identity category | Predictions |
|---|---:|
| Final status, manual-only | 56 |
| Final status, not manual-only | 7 |
| Rescheduled to a future kickoff | 16 |
| Postponed | 8 |
| Cancelled | 3 |
| Abandoned | 1 |
| Other not-confirmed-final status | 4 |
| Stored teams do not match returned fixture orientation/pairing | 5 |
| Missing/invalid fixture identifier | 2 |
| Valid-looking id without a returned live fixture | 4 |
| **Total** | **106** |

No automatically eligible single was among the final-status records. Final
status alone does not certify regulation score, selection validity, entitlement,
or authority to correct a historical prediction. Two ids were not returned;
that is **unverified**, not proof that the fixture never existed or that a
subscription restriction caused the omission. No subscription/API error was
reported for these four requests. Historical failed-lookup reasons do not prove
the provider is failing now.

### Manual queue and compounds

All 15 pending published compounds were examined from stored leg references:
14 waited on a manual-only leg; one had a missing leg. These are genuine human
review/dependency queues, not singles the settlement cron should force through.
The ordinary settlement query excludes compounds, and the compound pass waits
for valid leg outcomes. Neither behavior is weakened.

The 91 manual-only records have these redacted stored-reason categories:

| Recorded reason category | Count |
|---|---:|
| Lookup exhaustion | 39 |
| Score/selection evidence requires review | 29 |
| Still-not-final/backstop | 18 |
| Different fixture pairing | 3 |
| Team orientation review | 1 |
| Compound references require review | 1 |

Those reasons explain why ordinary cron does not select them. No flags were
reset and no outcomes were invented. Which historical manual cases can now be
resolved requires individual authoritative score/identity review, not a bulk
reopen based on this report.

## Job outcomes: zero predictions is not zero useful maintenance

The 03:36 WAT read-only comparison covers up to 200 records/job over the preceding
24 hours (all sampled jobs were below that cap). The production page itself
retains a 100-record/job cap, so a capped page row is not a full-day total.

| Job | Observed runs | Corrected interpretation of stored records |
|---|---:|---|
| generation-discovery | 96 | 88 completed scans without newly queued candidates; 8 queued candidates. Original classifier called all 96 UNKNOWN |
| refresh-odds | 96 | 85 completed quote-refresh maintenance; 9 provider responses with no quoted market; 2 with nothing due. Original classifier called all 96 UNKNOWN |
| generate-vip-premium | 96 | 6 output runs, 89 no eligible target, 1 retained generation failure |
| generate-goals | 96 | 4 output runs, 3 completed without newly recorded predictions, 83 no-target runs, 5 lease deferrals, 1 retained generation failure |
| generate-european-clubs | 48 | 39 no-target runs, 9 lease deferrals; old classifier called deferrals failures |
| generate-ordinary | 132 | 23 output runs, 80 no-target runs, 8 Banker-curation alias runs, 20 lease deferrals, 1 quota deferral |
| generate-bet-of-the-day | 1 | No eligible priced generation target; not a broken cron |
| select-bet-of-the-day | 1 | A selection was pinned; old classifier missed the `action` result shape |
| settle | 9 | Curation/upcoming-kickoff maintenance completed, while the singles queue was empty |
| results-pass | 128 | 9 outcome-producing runs; 50 empty eligible queues and 69 awaiting confirmed-final evidence |

Root instrumentation gaps: the generic classifier did not recognize
`candidatesQueued/leaguesScanned`, `okCount/failedCount`, selector `action`, nested
Banker curation, or settlement's maintenance work. It also treated the explicit
shared-lease stand-down `ok:false` as a failure despite zero failed attempts.
The new classifier is job-specific and keeps productive output, maintenance,
no work, deferral, failure and unknown separate. It recognizes only explicit
no-quote responses as market unavailability; unrecognized failures remain
failures/unknown. It does not lower a quality bar or fill publication quotas.
The two actual generation failure counters are retained, not relabelled healthy.
Their stored messages were UNCLASSIFIED_STORED_ERROR under the deliberately
redacted diagnostic. Their precise causes and attribution to this deployment
are **not established**. An authorized operator should inspect the two existing
VIP/Goals entries in `/admin/failed-generations` or restricted job details,
compare their timestamps to the #181 deployment, and classify them without
exporting paid fixture content or secrets. No generation-engine fix is justified
from those two counter values alone.

### Schedules and dependencies

Observed median gaps were approximately 15 minutes for discovery, odds, VIP,
Goals and ordinary generation; 30 minutes for European clubs; 180 minutes for
settlement; roughly 12 minutes between recorded results passes (inside the
notification-dispatch lease). These are observed records, **not an exported
external scheduler configuration**. Ordinary generation also records Banker
maintenance under its historical alias.

Checked-in Vercel/VPS schedules still contain daily settlement at 07:00 WAT and
accumulator curation at 11:30 WAT. External cron-job.org settings are inaccessible
from the available authorized sources; their exact URLs, retries and enablement
remain unverified. The stored 06:20/06:50 WAT daily Bet-of-the-Day generation/
selection runs were from the preceding day; at 03:36 WAT today's observed daily
times had not arrived. That is not evidence of a missed run. No schedule changed.

## Focused corrections

1. Settlement findings require a published pending record. Archive/draft/approved
   age alone is not settlement delay. Manual, compound, rescheduled, non-final,
   missing-status and cached-final queues have separate codes/explanations.
   Cached statuses are explicitly not live verification. Expired review and
   approval history is distinct from current/upcoming review.
2. Findings carry CURRENT/HISTORICAL periods using Lagos-day boundaries. Group
   by code/severity/period, show counts and at most ten expandable samples/group,
   and add a period filter. Informational evidence gaps are not hundreds of
   amber operational alarms.
3. Prioritize current/upcoming predictions, then most recent history within the
   same 500-row cap. Report exact cohort total, capped sample and composition.
   Job metrics remain global to the time window; category/competition filters
   apply to predictions, period/severity filters to findings. The UI says so.
4. Job-specific classification reads existing historical payloads without
   rewriting them. Future direct and wrapped job logging persists the same
   classified metadata; raw payloads and reported-success flags remain intact.
   Transport/reporting completion is not equated with new predictions.
5. Explicit no-market quotes mean missing price evidence, not provider outage;
   unknown error notes remain unknown. Ordinary/legacy paid records without
   indicative price evidence are informational; missing required dedicated paid
   publication evidence remains critical. Early VOID timestamps require refund/
   reschedule review rather than an automatic assertion of an incorrect win/loss.
6. Only eligible ordinary candidates created after evidence that Sprint 06
   collection began are flagged for a collection check. Dedicated, compound,
   pre-collection and sub-floor cases are not automatically expected to have
   snapshots. Missing records still require checking runtime flags/curation
   history before declaring a genuine collection failure. No production
   collection defect was established, and no record is backfilled.
7. Manual single-settlement recovery preview now rejects compounds and missing
   league/name metadata, matching the unchanged settlement resolver's scope.
   It does not reset manual flags or enable recovery.

No settlement engine, publication validator, prediction selection, subscription,
payment or entitlement transition is changed. Sprint 04 atomic evidence,
Sprint 05 coverage, Sprint 06 snapshots and Sprint 07 recovery controls remain.

## Validation and remaining verification

82 new pure regressions reproduce production payload shapes and false-warning
conditions, without copying prediction content. New disposable PostgreSQL tests
cover 510 archived rows plus active records, priority sampling, exact totals,
manual/compound/unknown/history grouping, review queues, period filters,
post-collection versus legacy/dedicated observation expectations, aligned retry
eligibility, job metadata, and unchanged prediction/audit state after reads.

The 73 remaining original operations checks pass. The original operations regression expectations are updated only where the
confirmed false alarms were removed: unconditional age-only delay, blanket
missing historical snapshots, and old expired-review severity. Their publishing,
market, entitlement and settlement safety checks remain.

Release checks include the new suite, 17 existing relevant suites, TypeScript,
and five real disposable PostgreSQL suites: investigation, Sprint 07 operations,
atomic publication, immutable snapshots and current-mode VIP/PREMIUM observation.
These continue to verify no duplicate/unfinished settlements, no started-match
publication, no paid-access regression, and no unauthorized recovery. They are
regression evidence; the production findings above come from the read-only runs.
Actual final-SHA CI status is recorded on the PR.

Remaining production verification:

- Review the 91 historical manual cases and compound dependencies through
  authorized admin tools; verify final/regulation scores and identities first.
  This task intentionally makes no repairs or outcome claims.
- Investigate unmatched identifiers individually; do not substitute guesses.
- External scheduler owners should export only redacted job names, enabled
  state, schedules and HTTP result aggregates for comparison with observed
  cadence. Do not share secrets or scheduler tokens.
- A genuine observation failure requires post-collection eligibility,
  successful curation and enabled runtime collection; absence in a historical
  row alone is not enough. Existing immutable snapshots are never rewritten.
- The five-request provider cap and absent native cache mean some live states
  remain unverified; the dashboard does not add provider polling to hide this.

Reproduce safely via Actions → Published evidence audit (read-only), select this
reviewed branch, scope=operations and provider=false. The optional provider=true
probe performs <=5 id-batch GET requests with existing masked credentials and
never writes usage/settlement records. Never run settlement/recovery endpoints
to perform an investigation. No schema, cron, provider budget or activation flag
change is required. Rollback reverts this corrective branch; no data rollback
or historical audit deletion is needed. Automatic recovery remains disabled.
