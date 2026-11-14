# Sprint 06 — prediction reliability, calibration, price evidence and risk

## Release decision

Keep the current live baseline. **No new policy is eligible for activation.**
This implementation supplies prospective measurement and research infrastructure;
it does not demonstrate improved predictions or profitable subscriber returns.
No production database, migration, cron, flag, merge or deployment was changed
while preparing it. All new tests use synthetic data or disposable PostgreSQL.

Base: `db778a891e7ebe05de7305e67884df494791b131`, latest master at checkout.
GitHub confirms Sprint 05 #179 is merged; Sprint 04 is #178 (`5f4c36f`).

## Existing-system audit and findings

| Area | Existing implementation and finding | Sprint 06 treatment |
|---|---|---|
| Generation/enrichment | `generation/worker.ts`, `ai/analysis.ts`, `vipPremiumPipeline.ts`; structured predictions and provider-stated confidence, supported by form/standings/odds inputs and consistency rules | Preserve generation and public confidence |
| Probability meaning | `Prediction.confidence` is a stated heuristic/model confidence, not an empirically certified probability. `marketConfirmed.ts` computes a separate de-vigged market measure. Their agreement is an admission check, not calibration | Keep raw, market and empirical estimates separate |
| Calibration | `calibration.ts` already implements Platt/logistic, isotonic, hierarchical pooling, Brier/log loss/ECE and uncertainty. `calibrationArtifact.ts` contains the **inactive** `cal-20261113-1` | Reuse scoring/Wilson infrastructure; add conservative bin evidence with minimum sample/staleness checks, never activate the old or new model |
| Previous calibration evidence | Committed run #37: hierarchical model-only calibration improved validation Brier by −0.0037 but worsened final-week Brier by +0.0047. Adding model information to market also worsened the held-out week (+0.0055) | Evidence does not justify claiming calibration success; do not silently substitute displayed confidence |
| Odds | `odds.ts` trims API-Football odds to supported lines; keeps aggregate median, best, bookmaker count, **top five named comparison quotes**, provider `update`. `FixtureOddsCache` has the local fetch time and retains the latest payload | Capture exact quote labels, named quotes, both clocks, and provenance alongside decision; no extra provider calls |
| Historical prices | Latest cache may be near closing, unavailable at original selection time. Publication evidence from Sprint 04 is indicative, not independently verified subscriber entry | Explicit opening / decision / publication / closing / subscriber-entry roles; unknown roles stay null |
| Value | `paidValue.ts`, `paidSelection.ts`: existing median-price EV, calibration and diversification, with derived DNB handling | Add independent strict research price audit and lower-bound EV; do not modify old value-mode semantics |
| Publication/access | `predictions.ts` atomic publication/evidence; existing subscriber, render, entitlement/payment guards | Observer is outside publication transaction, failures caught; run existing guards and disposable publication test |
| Coverage | Sprint 05 registry and evidence, coverage lane, `COVERAGE_ROLLOUT`, `PAID_QUALITY_POLICY` | Competition id remains available for grouping; no change to discovery or paid eligibility |
| Paid selection | Existing #175 curation, `PAID_SELECTION_MODE`, inactive artifact fallback; Premium overlaps VIP in previous analysis | Freeze actual selected ids per tier; evaluate VIP and PREMIUM separately on the same baseline universe |
| Shadow/research | `paid-selection-shadow`, quality decisions, `paidPolicyResearch.ts`, chronological validation, prior holdout controls | Add immutable first-observation records; previous run logs can repeat and quotes previously lacked full provenance |
| Operations | Admin layout guards `/admin/paid-ops`; existing historical quality/coverage explorer | Extend same page, no public UI or new public endpoint |

Prior numerical findings are **citations to committed Sprint 04/05 evidence**, not
newly queried production observations. In particular Sprint 05 continuation H4
was −2.8% closing-reference versus −2.0% baseline on its holdout; none of its
policies earned activation. That history has already informed hypotheses and
cannot become an untouched Sprint 06 holdout. See `vip-sprint05-evidence.md`.
No unsupported statement such as “80% confidence wins only 69%” is made.

## Implemented backend

- `predictionReliability.ts`: chronological outcome-availability filtering,
  duplicate fixture/market exclusion, reliability bins, pooled fallback,
  explicit uncalibrated/stale/evaluation-only estimates, Wilson uncertainty,
  raw Brier/log loss/ECE, price audit, per-book overround, conservative research
  value classifications, deterministic structural warnings/concentration.
- `reliabilityPrice.ts`: captures exact provider market/selection, bookmaker
  quotes and both original timestamps. Malformed evidence returns unavailable
  rather than changing the live assessment. No timestamp is reconstructed from
  rounded quote age. Exhaustive same-book 1X2/BTTS sets can supply overround;
  overlapping double-chance outcomes cannot. Missing selections remain unknown.
- `reliabilitySnapshot.ts`, `reliabilityStore.ts`: one first decision per
  version/tier/prediction. A SHA-256 deterministic `JobRun.id` plus
  `createMany(skipDuplicates)` makes retries/concurrent runs idempotent.
  Decisions, reference prices, flags, baseline overlap and risk reasons are
  immutable; settlements are joined later. Never overwrite features with
  closing data or settled outcomes. A distinct job name prevents contamination
  with Sprint 05 records. No subscriber identifiers are included.
- `reliabilityDiagnostics.ts`: joins current settlement to frozen features,
  reports markets, competition ids, confidence bands, tier, 12-hour horizon
  bands and price status. Validity coverage is separate from success rate.
  Binary scores omit void/push/unsupported market semantics rather than
  interpreting refunded stakes as losses. Competition estimates shrink toward
  pooled outcomes with 50 pseudo-observations; Wilson intervals/sample counts
  remain visible. This is descriptive, not a league ranking or eligibility rule.
- Admin page: expandable bounded segment tables with raw versus observed,
  uncertainty, Brier/log loss/ECE, price roles, named quote/overround coverage,
  model status, structural warnings and policy overlap. Query failures show an
  unavailable state. Existing design system and horizontally scrollable tables.
- `reliabilityProtocol.ts`, offline research/export scripts and CI workflow.

### Calibration status and model lifecycle

Existing logistic/isotonic research is retained; its failed final-week result is
not overridden by choosing a more elaborate model. The new binned estimator is
an interpretable **evaluation comparator**, not a claim to a better method.
Training requires 200 unique fixture/market examples; market bins require 100
market examples and 40 in the relevant bin. Sparse markets use the pooled bin
only when its own count is sufficient. Missing support returns `UNCALIBRATED`.
Training excludes settlements at/after cutoff, decisions at/after kickoff,
invalid probabilities/dates and unsupported outcome semantics. Each model has a
version, cutoff, sample counts and 30-day expiry. Wilson intervals describe bin
sampling uncertainty, not a guarantee covering distribution shift.

`reliabilityModelArtifact.ts` intentionally exports null. The fit command writes
a versioned local artifact for review; it cannot install or activate it. A
reviewed artifact code change is needed to collect model evaluation estimates.
Stale models yield no estimate. Restore a previous still-valid artifact or null
to roll back. Nothing rewrites public confidence or updates live calibration.

### Price/value semantics

The independent price audit requires exact matching labels, three distinct
named books, finite decimal odds >1, provider update <= observed <= decision <
kickoff, and update age <=120 minutes. Missing provider clocks fail closed.
Duplicate books never inflate depth; >15% dispersion is suspicious, not proof of
an error. Suspension evidence, where true, rejects the quote; null explicitly
means unknown. Derived DNB prices are never passed as direct quotes.

Research quote median is calculated from the cache's **retained top-five
comparison subset**. It is not the full-book median and is not guaranteed
available to any subscriber. `executableEntry` is always false. Opening,
publication, closing and subscriber entry are null unless independently
captured by the appropriate existing system; they are never backfilled with
this decision quote. Full market depth/suspension history cannot be recovered
from the trimmed payload. Overround uses only complete same-book exhaustive
outcomes; aggregate medians or overlapping selections are not substituted.

EV = p × odds − 1 and its lower-bound counterpart are emitted only for supported
binary outcome semantics, valid prices and supported empirical estimates.
Positive lower-bound EV yields `POSSIBLE_VALUE`, **not proven value**, and cannot
activate anything. Other outcomes include missing/invalid/stale price,
insufficient evidence, uncalibrated and no demonstrated value. DNB, team totals,
handicaps and composite/exotic markets remain insufficient for this binary
value model; existing settlement and live support are preserved. No subscriber
ROI is calculated from indicative prices.

### Risk

Duplicate picks, mutually exclusive 1X2/BTTS selections, same-fixture dependence
and shared-team relationships (when ids are supplied) are structural warnings.
Overlapping different goal lines are not falsely called direct contradictions.
Concentration counts cover market, competition, confidence and odds bands.
Combined probability and numerical correlations are explicitly null: this
history cannot justify coefficients. The pipeline does not yet supply team ids
to this observer, so cross-fixture team warnings remain unavailable there.
Only 48 relationships per candidate are retained, with a cap indicator.
No automatic combination, accumulator or diversification change is made.

## Chronological validation and policy research

Protocol `s06-prospective-202612-v1` is committed before evaluation:

| Period (UTC boundaries) | Purpose |
|---|---|
| 1–31 Dec 2026 | Development |
| 1–31 Jan 2027 | Validation |
| 1–28 Feb 2027 | Final holdout |
| 8 Mar 2027 onward | Earliest final evaluation, after settlement allowance |

Earlier November snapshots are useful operational diagnostics, not protocol
holdout observations. Do not move these dates after inspecting results. If
collection begins too late, declare this protocol infeasible and preregister a
new future cohort instead of borrowing prior outcomes.

Predeclared **subset-only** policies, separately per tier:

1. Empirical lower probability bound >= the original raw confidence (no new
   fixed nominal threshold).
2. Positive lower-bound reference EV with strict price evidence.
3. Deterministic diversification: one per fixture, <=2 per competition per
   two-hour kickoff slot; confidence/id tie-break, no new arbitrary weighted
   score. This is a new prospective check of a hypothesis that failed before,
   not a reason to enable it.

Flags are recorded before settlement. Evaluation uses those flags, not
retroactively applied models or today's prices. Null/disabled flags do not
qualify. Baseline and candidates use the same versioned first-observation
universe. VIP and PREMIUM are never combined into one purported independent
sample. Non-binary markets are excluded explicitly from this protocol.

Both development and validation must pass before a hypothesis's final-holdout
results are released: >=100 decided picks, >=20 priced fixture days, >=80% price
coverage for baseline and candidate, >=50% retention, no unresolved/void sample,
no inferior observed win rate, positive paired day-cluster bootstrap improvement
interval. The interval uses 2,000 deterministic replicates, Bonferroni correction
for **six** tier/hypothesis comparisons (family alpha .05). This is a screening
rule, not a formal proof of future profitability or statistical noninferiority.
Calibration scores are reported alongside returns and coverage.

Offline final evaluation refuses to run before maturity. It writes an exclusive
protocol receipt (input SHA-256/time) independent of input filename, and refuses
a second evaluation with that receipt present. Preserve receipts/results in the
review evidence; this local operational guard is not a tamper-proof registry.
No policy failing development/validation receives displayed final-holdout
scores. Successful research still returns `activationAllowed:false` and requires
explicit approval and reviewed implementation before any live strategy change.

**Results now:** no Sprint 06 production sample, independent holdout or policy
success is asserted. No policy passed; none has failed a completed Sprint 06
prospective test yet. All remain shadow-only. The existing baseline is retained.
Existing historical performance remains documented in Sprint 04/05, with the
closing-reference versus subscriber-entry limitation intact.

## Reproduction

```sh
npm ci
npm run check:prediction-reliability
npm run check:paid-market-quality
npm run check:league-coverage-quality
npx tsc --noEmit
# Read-only export, only after records exist; requires authorized DB credentials:
npx tsx --env-file=.env scripts/export-reliability.ts work/s06-observations.json
# Fit is blocked until the development period ends; output is never auto-installed:
npm run research:prediction-reliability -- fit work/s06-observations.json work/s06-model.json
npm run research:prediction-reliability -- validation work/s06-observations.json work/s06-validation.json
# Blocked before 8 March 2027; output paths must not exist:
npm run research:prediction-reliability -- holdout work/s06-observations.json work/s06-holdout.json
```

Export uses an explicitly read-only database transaction, selects no subscriber
fields, rejects truncated snapshot universes and caps at 100,000 observations.
Raw files/receipts are local intermediates and are not committed. Future
larger cohorts need a reviewed paginated export.

## Verification evidence

- New pure suite: **102 passing checks**, synthetic fixtures only.
- Disposable PostgreSQL 16: concurrent same-key writes produce exactly one
  record; later retries preserve original decision; off switch writes nothing;
  simulated storage failure does not escape. PASS.
- Existing disposable PostgreSQL publication suite: atomic publication/evidence,
  concurrency, idempotency and rollback. PASS.
- All 12 targeted suites pass: new reliability; paid-market-quality (all eight
  sub-suites); league coverage (126); calibration/value (59); value integration
  (55); overlay (228); selection (75); subscriber (87); render (21);
  subscription entitlement; Paystack entitlement; one-time fallback.
- TypeScript `--noEmit`: clean. Diff whitespace checks: clean.
- Full preflight: **85/89**. House banners, goals category and sitemap scoping
  failures reproduce on untouched `db778a8`; navigation fit cannot launch its
  missing Playwright browser in this environment, also reproduces on master.
  These failures are not hidden or rewritten.
- New `prediction-reliability` Actions workflow runs the new and existing guards,
  TypeScript, and both disposable PostgreSQL suites. Actual PR CI status is
  reported on the PR and in the delivery report, independently of these local
  checks. CI success is not evidence of improved predictive performance.

## Deployment ordering, cost and rollback

**No Prisma/schema change, migration or new provider request.** Existing JobRun
primary key and `(job, ranAt)` index are sufficient. Deploying the code requires
no new table and preserves old binaries. No production migration was run.

New independent controls:

| Flag | Default | Effect |
|---|---|---|
| `RELIABILITY_DIAGNOSTICS` | enabled unless `off` | First-decision storage |
| `RELIABILITY_CALIBRATION` | disabled unless `evaluate` | Evaluate reviewed non-null research artifact only |
| `RELIABILITY_SHADOW` | enabled unless `off` | Record policy flags, never live selection |

No flag enables Sprint 06 live behavior. Existing `COVERAGE_ROLLOUT`,
`PAID_QUALITY_POLICY`, `PAID_SELECTION_MODE` retain their exact meanings.
The observer follows the existing paid shadow-hook invocation; if that hook is
not called (e.g. selection `current` skips logging), this observer cannot invent
missing snapshots. Monitor gaps before evaluating a cohort.

Each run handles <=500 candidates. Idempotent bulk insert plus <=500 expired-row
lookup/deletion runs in a separate transaction (2-second timeout, 500ms maximum
pool wait); caught errors cannot roll back publication. Capping or failures make
research incomplete, not automatically successful. Admin queries cap 1,000
snapshots/90 days and 80 groups per dimension, with truncation displayed.
Retention deletes only this job's records older than 180 days in bounded batches
when collection runs. If disabled, cleanup pauses too; operator archival/cleanup
is needed for longer disablement. Preserve an export before evidence expires.

API-Football incremental cost: **zero requests**. Compute is bounded by 500
candidate pairwise structural checks and snapshot serialization, plus DB writes.
Storage depends on unique candidates, not retry count. For capacity planning,
200 unique tier/candidate snapshots/day ×180 days ×4–12 KiB is roughly
140–420 MiB payload, before indexes/WAL; measure actual payloads before scaling.
Same-price provenance is also carried in the legacy run log, so its existing
retention/storage must continue to be monitored. No scheduler change is needed.

Release review: inspect this PR, its CI and operational storage budget. Merge or
deploy only through the owner's normal process; neither was performed here.
Rollback: set `RELIABILITY_DIAGNOSTICS=off`, `RELIABILITY_SHADOW=off`, leave
calibration disabled, then revert the Sprint 06 commit if necessary. Old logs
remain harmless, namespaced by version/job. No destructive rollback migration.

## Remaining evidence requirements

- Deploy to begin collecting; this PR did not write production observations.
- Review/install a dated research model before prospective probability/EV
  hypotheses can produce estimates; stale or absent models stay uncalibrated.
- Independently verified subscriber entry prices are absent; no realized ROI.
- Full bookmaker quote sets, suspension history, opening/closing series, country,
  season, feature completeness and cross-fixture team ids are not all preserved
  by the current observation input. Unknown fields are not reconstructed from
  later enrichment. Extend the versioned snapshot prospectively if needed.
- Shared drivers beyond fixture/team and exact numerical correlations remain
  unestimated. DNB/line-push/composite probability semantics require separate
  outcome models. No market is removed from live publishing for this limitation.
- Prospective periods have not occurred. No claimed holdout win, calibrated
  probability improvement or activation recommendation is possible today.

Recommendation: review the infrastructure with the baseline unchanged; do not
activate any new prediction policy. Resolve/acknowledge the documented master
preflight failures through the normal release process, and require passing PR
CI before merging. A successful build cannot substitute for future evidence.
