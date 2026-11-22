# Early Engine — Remediation Report (22 November 2026)

Evidence labels used throughout: **Code** (confirmed in the repository), **Test** (executed in this audit), **Simulated** (offline replay, `docs/audit/early_freshness_simulation.csv`), **Historical** (production figure recorded earlier in the repository), and **Not measured** (needs the read-only scripts run against production). No 15–21 November production data was accessible; see `EARLY_ENGINE_DEEP_AUDIT.md` §0.

---

## Section A — Executive summary

| Question | Answer |
|---|---|
| Is the early engine functioning correctly? | **Mechanically yes, effectively no.** Discovery, cache-only generation, holds and atomic publication all work as written. Three confirmed defects meant drafts made 3–14 days out could almost never publish automatically, and one quality gap allowed outdated drafts to publish. |
| Is stale data affecting prediction quality? | **Yes, in two opposite ways.** (1) Usable evidence 12–48h old was wrongly classed as unreliable, so good drafts were blocked. (2) Young evidence that missed a match played since was wrongly classed as reliable, so outdated drafts could auto-publish (**Test**: reproduced on the pre-fix code). |
| Can it operate 4–7 days ahead? | **It can assess 4–7 days ahead; it can rarely publish that early,** because bookmaker quotes are mostly absent that far out (**Historical**: 13% beyond 7 days, 100% inside 72h). With the fixes, a 4–7-day assessment is kept as a held draft and auto-publishes when a qualifying quote appears, if its evidence is still current. |
| Why are automatic publications few? | Mainly the frozen `contextComplete=false` flag caused by a 12h freshness floor that contradicted the 48h refresh tier. **Simulated:** only 0.9–6.3% of 3–14-day drafts could pass the old rule. Contributing causes: soonest-first ordering, head-of-line blocking, lease contention and odds fetch aim. Confidence (70) is a legitimate filter and was not changed. |
| Is the API-Football allowance used efficiently? | **Not measured** for 15–21 Nov (no access; no hourly/job/outcome telemetry existed). **Historical:** the quota was exhausted on some days between 14 Oct and 13 Nov (about 130 paid stand-downs). Telemetry is now added so efficiency can be measured rather than assumed. |
| Single biggest bottleneck | The freshness contradiction (12h early floor vs 48h refresh tier), which froze drafts as permanently ineligible. |
| What was fixed | 8 corrections (Section F), all with zero added API-Football calls and zero added model calls. |
| What remains unresolved | Production measurement of the funnel and usage; throughput limit of about 1–2 early model calls per run; enrichment-cron lag; dedicated telemetry table; existing held drafts generated under the old rule stay ineligible (deliberately not re-classified). |

**Overall health:** *Amber.* Safeguards (paid isolation, atomic publication, immutable receipts, recoverable holds, evidence guard) are sound. Throughput and observability were the weak points; both are addressed but await production validation.

---

## Section B — Seven-day API-Football consumption

Full detail: [API_FOOTBALL_7_DAY_USAGE_REPORT.md](API_FOOTBALL_7_DAY_USAGE_REPORT.md).

- Daily, endpoint, hourly and job-level actuals: **not measured** (no access). Fillable per UTC day × endpoint from existing `ApiUsage` rows with `scripts/audit-api-football-usage.ts`. Hourly, job and outcome splits are possible only from deployment of this change.
- Quota: 7,500/day code default, reset 00:00 UTC (01:00 WAT). The production value must be verified with `--status` or the dashboard.
- Attribution limitation (before): none. After: 15 labelled routes; everything else explicitly `unattributed`.

---

## Section C — Detailed diagnosis of the three issues

### Issue 1 — Early predictions and outdated data

| Field | Explanation |
|---|---|
| Problem | Cached evidence was judged by one flat age floor. Drafts with 12–48h-old (policy-compliant) caches were frozen as incomplete; caches that missed a match played since were accepted. Early drafts were never re-checked before publication. Recent-form claims were not checked against the evidence. |
| Severity | **Critical** (publication blocked) / **High** (outdated drafts could publish). |
| Evidence | **Code:** `generationContext.ts` 12h/24h floors vs `enrichment.ts` `REFRESH_TIERS` (48h beyond 72h); `generate.ts` freezes `contextComplete`; `earlyPublication.ts` blocks on it; the reassessment worker covers PUBLISHED only. **Test:** `check-early-remediation-postgres.ts` fails on the pre-fix `earlyPublication.ts` with "a pick whose evidence misses a match played since is NOT auto-published". |
| Root cause | Confirmed: contradictory freshness rules and no event-based invalidation. |
| Frequency | **Simulated:** old rule pass rate 0.9–6.3% (3–14 days), 3.7–100% (48–72h). Of the 48–72h drafts the old rule passed, up to 13.8% were missing a match played since. Production: **not measured** (`8c_context_complete`, `evidence`, `provenance` per band in the funnel audit). |
| Solution implemented | `src/lib/ai/evidenceFreshness.ts`: tolerance by kickoff distance equal to `REFRESH_TIERS`, plus supersession from `UpcomingFixture` kickoffs; per-part provenance saved on `AIJob.context`; publication-time `evidence-superseded` gate that fails closed if unchecked; generation-time recent-form claim stripping. |
| Expected improvement | **Simulated** pass rate for 3–7-day drafts rises from 6.3% to 51.0–73.5% with the cron on time (15.1–32.7% at 24h lag). Outdated drafts can no longer auto-publish. |
| Potential consequences | Drafts 4–7 days out can now be complete with team data up to 48h old; injuries in that data may be older than before (unknown availability is still never presented as "fit"). In 48–72h the pass rate falls slightly (e.g. 100% → 86%) because superseded caches are now excluded. Supersession only sees matches in competitions we capture; other cup games are bounded by the age tolerance only. |
| Verification | 74 unit assertions (`check-early-evidence-freshness.ts`), Postgres integration test with a before/after run, plus existing suites (digest 46, generation 138, generation-evidence, reassessment, match-evidence render). |
| Outstanding work | Measure the production pass rate per band after one week. Consider an automatic regeneration for superseded holds (adds model calls, so this needs approval). |

### Issue 2 — Generating 4–7 days ahead

| Field | Explanation |
|---|---|
| Problem | Under backlog, soonest-first ordering worked every fixture at 48–72h. Selective-league fixtures without a cached table blocked the run's slots indefinitely. Leagues new to the engine had no standings cache at all. |
| Severity | **High.** |
| Evidence | **Code:** `earlyGeneration.ts` sorted by `kickoff asc` and sliced before the worker's `filterSelectiveQueuedCandidates` (cache-only), which drops rows with no ledger write; `getScopedLeagueTargets` covered PUBLISHED leagues only. **Test:** the integration test shows a gated fixture deferred once and not re-selected 30 minutes later. |
| Root cause | Confirmed: selection order and filter order; enrichment scope. |
| Frequency | **Not measured**. Every one of the 7 spotlight leagues is selective, and each is scanned every 3.5h, so exposure is structural. |
| Solution implemented | Selective gate applied before choosing; gated fixtures get `FAILED` + 6h retry, attempts **not** counted, visible reason. Ordering: priced, then 3–7 days, then 48–72h, then 7–14 days. `queueByBand` and `deferredSelective` in every run report. Standings workload rotates leagues with queued early fixtures in the next 7 days (same per-run call count). |
| Expected improvement | Early run slots are no longer wasted on unworkable fixtures; more drafts exist 3–7 days out; new leagues gain standings. |
| Potential consequences | Standings for already-published leagues refresh somewhat less often, in proportion to the added leagues; the leagues workload limit is unchanged. Unpriced 3–7-day drafts take slots before unpriced 48–72h ones; the latter still go to ordinary generation inside 48h if not reached. |
| Verification | Unit ordering test, integration deferral test, existing `check-early-fixtures`, `check-early-odds` (string assertion updated to the new intent). |
| Outstanding work | Measure backlog (`queueByBand`). If it grows, consider relaxing the 22s soft deadline for the VPS-only early run (more model calls per hour, but the same calls per fixture; needs approval). |

### Issue 3 — Few automatic publications

| Field | Explanation |
|---|---|
| Problem | Few early drafts reached the site automatically. |
| Severity | **Critical** (product goal not met). |
| Evidence | Issue 1 and 2 evidence, plus: `early-run` at :09/:39 shares the `generation-run` lease with ordinary generation at :10/:40 (**Code**, `worker.ts` `LOCK_KEY`, crontab, `GENERATION_SCHEDULING.md`); odds warming spent its 4 fetches per pass without regard to whether a draft could publish. |
| Root cause | Confirmed: the freshness contradiction (dominant), ordering, head-of-line blocking, odds aim; plausible: lease contention (depends on run duration, **not measured**). |
| Frequency | **Not measured** (funnel audit `9_auto_published` vs `7_early_generated`; `leaseStandDownsByLagosMinute`). |
| Solution implemented | Fixes from Issues 1–2; `early-run` moved to :27/:57 (lease-TTL guarantee, review round 2); early odds fetches ordered *publishable-if-priced*, then *not generated*, then *review-only*, with `attemptedByYield` reported. |
| Expected improvement | More drafts eligible (Issue 1 simulation), and quotes aimed at them. Expected direction is up; magnitude **not claimed** until measured. |
| Potential consequences | More automatic publications means more public early tips, each still behind the 70% floor, two-sided evidence and an exact fresh quote. |
| Verification | Integration test: a fully qualified draft still auto-publishes (control), a superseded one is held, and a published row is untouched. |
| Outstanding work | One week of funnel data; compare `qualifying/published` before and after. |

---

## Section D — Early generation funnel

The stage definitions, gates and audit fields are in `EARLY_ENGINE_DEEP_AUDIT.md` §4.1. **Production counts by band (A 0–24h, B 1–3d, C 4–7d, D 8–14d, E >14d) are not measured.** Produce them with:

```bash
npx tsx --env-file=.env scripts/audit-early-engine-funnel.ts --from=2026-11-15 --to=2026-11-21 --out=docs/audit
```

Expected loss points by code (ranked): evidence completeness (C/D bands), odds availability (C/D), ordering under backlog (C), selective gate (spotlight leagues), lease contention (all). Average and median capture → generation → publication times are computed per band by the script.

---

## Section E — API optimisation opportunities (ranked)

| Rank | Opportunity | Requests saved/day | Complexity | Quality | Early coverage | VIP/Premium | Risk | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | Measure before optimising: hourly/job/outcome telemetry and repeat detection | 0 (enabler) | Low | — | — | — | +1 DB upsert per request | **Done** |
| 2 | Align early freshness with refresh tiers (avoids pressure to refresh early teams every 12h) | Avoids up to 4 calls/team/12h a 12h-floor design would need. Not calculable without volumes | Low | ↑ (event-aware) | ↑↑ | none | older injuries 4–7d out | **Done** |
| 3 | Yield-ordered early odds | 0 saved; better use of ≤192/day | Low | — | ↑ | none | review-only drafts wait longer for quotes | **Done** |
| 4 | Standings rotation includes queued leagues | 0 added | Low | ↑ | ↑ | none | slower refresh of published leagues | **Done** |
| 5 | Skip leagues workload refresh when standings already refreshed after the league's latest kickoff (event-based, like H2H) | Up to (leagues refreshed/run × runs/day × 2) on non-matchdays; **not calculable** without the workload's production limit | Medium | none | ↑ (frees budget) | ↑ | stale table if kickoff data is missing | Recommended |
| 6 | Coalesce concurrent team refreshes (generation cache miss vs teams workload) | Equal to the `#d` repeats measured | Medium | none | — | ↑ | lock contention | Recommended after measurement |
| 7 | Skip `/injuries` when the team has no fixture in 72h (it changes daily but matters near kickoff) | ~1 per far-team refresh | Low | ↓ slightly for 4–7d | — | none | stale availability shown on team pages | Needs owner decision |
| 8 | Relax 22s soft deadline for VPS-scheduled early run | 0 API; more model calls per hour | Low | — | ↑ | none: the :27/:57 slot is clear for longer than the lease TTL | longer lease hold | Needs owner decision |

---

## Section F — Engineering changes

**Branch:** `ccr-41b5e06e-yac3s2` (one coherent PR, which includes PR #226's two commits).

| # | Defect | Files | Why it works | Tests | API calls | Publication eligibility | Adverse effects | Rollback |
|---|---|---|---|---|---|---|---|---|
| 1 | Flat 12h/24h floor contradicting the 48h tier | `src/lib/ai/evidenceFreshness.ts` (new), `src/lib/ai/generationContext.ts` | Same tolerance as the cron that fills the cache | unit 74, digest 46, generation 138 | **0** (one indexed DB read) | Wider for early drafts >72h with 12–48h caches | Older injuries 4–7d out | revert file; early lane returns to old floors |
| 2 | No event-based staleness | same + `knownRecentKickoffs` | A played match missing from the evidence makes it superseded | unit + integration | 0 | Narrower (superseded excluded) | Missed cup matches not detected | same |
| 3 | Outdated drafts could auto-publish | `src/lib/generation/earlyPublication.ts` | Re-checks the saved digest against matches since; fails closed | integration (before: published; after: held) | 0 | Narrower | More holds near busy midweeks | revert file |
| 4 | Head-of-line blocking; soonest-first ordering | `src/lib/generation/earlyGeneration.ts` | Gate before choosing; uncounted deferral; band order | unit + integration | 0 | none | 48–72h unpriced served after 3–7d | revert file |
| 5 | Odds fetches not aimed at publishable drafts | `src/lib/generation/earlyOdds.ts` | Same budget, ordered by yield | unit; `check-early-odds` | 0 (same ≤4/pass) | none | review-only drafts quoted later | revert file |
| 6 | New leagues never had standings | `src/lib/enrichment.ts`, `src/lib/enrichmentWorkloads.ts` | Rotation of a fixed-size workload | unit (scope guard) | 0 (fixed per-run limit; player-stats scope unchanged) | none | slower refresh of published leagues | revert files |
| 7 | Unchecked recent-form claims | `src/lib/ai/evidenceClaims.ts` | Strip sentences contradicted by, or beyond, saved last5/form | unit; match-evidence render | 0 | none (generation-time text only) | rare strip of a true but oddly phrased sentence | revert function call |
| 8 | Lease contention with ordinary generation | `deploy/ops/crontab` | :27/:57: the next lease user is 8 min away, more than the 6-min lease TTL | unit (schedule) | 0 | none | none known | restore `9,39` |
| 9 | No hourly/job/outcome usage data | `src/lib/football/usage.ts`, `api-football.ts`, 15 route files | Namespaced rows excluded from budget sums | unit (sorting, classification, attribution) | 0 provider; +1 DB upsert per request | none | DB write volume | `API_TELEMETRY=off` |
| 10 | Admin couldn't see which part was stale | `src/app/api/admin/predictions/[id]/route.ts`, admin page | Shows per-part status/age/limit (admin only) | tsc, build | 0 | none | none | revert |
| 11 | CI assertion broken by PR #226 | `scripts/check-market-sanity.ts` | Allows the added `context` select | ran | 0 | none | none | — |
| 12 | Audit tooling | `scripts/audit-early-engine-funnel.ts`, `scripts/audit-api-football-usage.ts`, `scripts/simulate-early-freshness.ts`, `src/lib/generation/earlyFunnel.ts` | Read-only reconstruction | unit (helpers) | 0 (`--status` = 1 unbilled) | none | none | delete |

**Tests executed in this audit (all passing unless noted):** `tsc --noEmit`; production `next build` (against a disposable Postgres 16); `check-early-evidence-freshness` (74); `check-early-remediation-postgres` (integration; fails on the pre-fix code, passes after); `check-early-readiness-db`; `check-early-fixtures`; `check-early-odds`; `check-reassessment`; `check-generation-evidence`; `check-generation` (138); `check-generation-failures`; `check-digest` (46); `check-market-sanity`; `check-bulk-generation-dedupe`; `check-matchfacts` (65); `check-goals-generation`; `check-enrichment-report`; `check-league-coverage-quality` (126); `check-competition-stage`; `check-seo`; `check-nonbrand-seo`; `check-cup-seo-coverage`; `check-match-evidence`; `check-match-render`; `check-match-lineups-odds`; `check-period-predictions`; `check-vip-quota-experiment`; `check-paid-integrity-guards`; `check-european-clubs`; `check-insights`. **Pre-existing failures, identical on untouched `master`:** `check-goals-category` (2 assertions), `check-team-total` (needs DATABASE_URL).

**CI wiring:** `preflight.yml` runs the unit suite; `early-fixtures.yml` runs the unit suite and the Postgres integration test.

**Deployment prerequisites:** none for the schema (no migration). The VPS deploy must ship the updated `deploy/ops/crontab`. Confirm `EARLY_FIXTURE_MODE` and `EARLY_FREE_PUBLICATION_MODE` are preserved (existing rollout process). Do **not** duplicate the early routes on cron-job.org.

---

## Section G — Expected results and risks

| Metric | Before | Expected after | Main risk |
|---|---|---|---|
| API consumption | Not measured (Historical: quota exhausted on some days in Oct–Nov) | Unchanged provider calls (every change is zero-call); +1 DB upsert per request | DB write load (disable with `API_TELEMETRY=off`) |
| Early fixture coverage | Not measured; structurally worked at 48–72h under backlog | More drafts at 3–7 days; no slots lost to gated fixtures | 48–72h unpriced served later |
| Evidence freshness | **Simulated** 0.9–6.3% complete (3–14d); superseded caches accepted | **Simulated** 15–74% complete (3–7d) depending on cron lag; superseded excluded | Supersession blind to uncaptured competitions |
| Automatic publications | Not measured | Up (direction only; no magnitude claimed) | More public early tips, all still behind unchanged gates |
| Retry success | Gated fixtures silently re-selected forever | Visible, uncounted 6h deferral; PR #226 4h evidence retry | Deferred fixtures may reach 48h before a table appears; ordinary lane then covers them |
| Paid generation reliability | Early run could hold the lease into paid/ordinary slots | :27/:57: an early run's lease always expires before the next VIP/ordinary/European slot; early lane spends 0 provider calls | cron-job.org schedules are outside the repo and could drift |

---

## Section H — Remaining decisions and recommendations

**Top five priorities**
1. Run both audit scripts read-only in production for 15–21 and 22 Nov, and commit the CSV/JSON to `docs/audit/`.
2. After one week of deployment, compare the funnel per band (especially `8c_context_complete`, `9_auto_published`) and the `provenance` mix; check enrichment-cron lag.
3. Read `leaseStandDownsByLagosMinute` for `generate-ordinary` before and after the re-timing.
4. Use `#d` repeats and `empty`/`review-only` counts to decide on coalescing (E6) and event-based standings skips (E5).
5. Decide whether superseded holds should be regenerated automatically (model cost) or left to admin rewrite.

| Status | Items |
|---|---|
| Completed and verified (offline) | Fixes 1–12; unit, integration, build and regression suites |
| Implemented, awaiting production validation | Publication uplift; freshness pass rate; lease contention removal; odds yield; telemetry |
| Requires additional evidence | All 15–21 Nov production numbers; queue depth; enrichment lag; duplicate volume |
| Requires your approval | Merge and deploy of this PR; E7 (injury refresh policy); E8 (soft deadline / model throughput); automatic regeneration of superseded holds; a dedicated telemetry table (`db push`); running the read-only audits with production credentials |
| Out of scope (unchanged) | Confidence thresholds; Free/VIP/Premium rules; payments, subscriptions, entitlements; public frontend design and copy; existing published predictions; additional data providers |

---

## Review round 2 (22 November 2026, after PR #227 opened)

### R2.1 CI: `alt-market-checks` failed 1 of 70 ("production generation never sets cacheOnly")

- **Diagnosis:** an outdated source-text assertion, not a regression. PR #218 (on master since 21 Nov) made the dedicated early FREE lane cache-only by design (`cacheOnly: input.intent === EARLY_FREE_GENERATION_INTENT` in `generate.ts`). The workflow's path filter does not include `generate.ts`, so the check never re-ran on master. PR #227 touched `generationContext.ts`, which is on the filter.
- **Fix:** replaced with five checks that enforce the intended rule and are stricter than before outside the early lane:
  1. every `cacheOnly` in `generate.ts` is derived from the early FREE intent, with no literal `true`;
  2. generation's odds lookup is cache-only only for that intent;
  3. the worker derives it only from that intent;
  4. early generation runs under the provider-call hard stop;
  5. no production module hard-codes `cacheOnly: true` outside early discovery.
- **Mutation-tested:** making ordinary generation cache-only (in `generate.ts` or the worker) fails three of the new checks. The suite now reports 74 passed, 0 failed.

### R2.2 PR #226 reconciliation

PR #226 is **open and unmerged** on GitHub, which is correct. "Merged into this branch" meant a fast-forward of the branch onto #226's head. Its two commits (`7a22d4a`, `0db2e0e`) appear **once each, with identical SHAs**, in #227's history; there is no merge commit and nothing was duplicated or rewritten. #226's head on GitHub is unchanged. If #226 merges first, #227's diff shrinks to the new work. If #227 merges first, #226 becomes empty and can be closed.

### R2.3 Publication safety: a kickoff time does not prove a match was played

- **Defect (confirmed):** supersession treated a captured fixture more than 150 minutes past kickoff as played unless its stored status was PST/CANC/ABD/SUSP/TBD. Discovery persists only *future* fixtures, and only the reassessment worker refreshes status after kickoff, so a past fixture's stored status is almost always its pre-kickoff `NS`. Postponements, abandonments and delays we never observed were treated as played.
- **Fix:** three-way resolution (`resolveKnownMatch`, `assessSupersession`):

| Outcome | Evidence | Effect on automatic publication |
|---|---|---|
| played | stored FT/AET/PEN, **or** either side's *current* team cache lists the result against that opponent within a day | `evidence-superseded`: held (>72h) or admin review |
| not played | PST, CANC, ABD, AWD, WO; or the fixture was seen rescheduled (kickoff moved, so it leaves the window) | none: evidence still current |
| unresolved | stale NS/TBD, live states (1H/HT/2H/ET/BT/P/LIVE), SUSP, INT, any unknown status | `evidence-currency-unverified`: not auto-published, stays in admin review, clears by itself once a cache confirms the outcome |

- A delayed or re-timed match already in the evidence (same opponent within 72h) is no longer mistaken for a new match.
- At generation, "unverified" is recorded but does **not** freeze `contextComplete`, because publication re-checks it with current data. "Superseded" still does.
- **Tests:** unit suite (110 assertions) covers every status above, case-insensitivity, the 150-minute window, opponent-cache confirmation and delayed-match matching. The Postgres integration test runs the real loader and publisher:
  - a cache-confirmed match is held as superseded;
  - an unresolved `NS` stays in review with the distinct reason;
  - a postponed match does not block publication;
  - a fully qualified control still publishes;
  - an existing published row is unchanged.
- **Residual limit:** matches in competitions we never capture are invisible to supersession, and the age tolerance still bounds those.

### R2.4 Resource consumption and paid protection

**Model calls (code-derived bounds; production frequency not measured)**

| Path | Before | After | Bound |
|---|---|---|---|
| Early generation | ≤3 fixtures/run × 48 runs (practically ~1–2/run; 22s soft deadline) | unchanged ceiling | ≤144/day hard, ≈≤96 practical |
| Runs previously wasted by head-of-line blocking (0 calls) | 0 | now generate | up to the same ceiling, not above it |
| Calls per fixture | 1 | 1 | ledger plus existing-prediction exclusion in both lanes. An early generation *replaces* the ordinary-lane generation for that fixture inside 48h. It is additive only for fixtures the ordinary lane would never cover (for example fallback leagues on healthy days). |
| Evidence/selective deferrals | — | 0 model calls | defer before the model |
| Form-claim rejection (whole reasoning unsupported) | n/a | ≤ +2 calls per affected fixture | existing 3-attempt ceiling; measure with `attemptErrorClass = unsupported-claim` |
| VIP/Premium | 8 attempts per kickoff day, 12 calls/day spend cap | unchanged | more early coverage can widen the overlay's candidate pool, not its cap |
| Goals | own run limit and daily cap | unchanged | — |

**Indirect API-Football effects of more publications:** published rows enter PUBLISHED-scoped enrichment (teams already covered via PENDING_REVIEW; new H2H pairs; odds for published picks within 72h; fixture details; reassessment). Every one of those workloads is capped per run (cron-job.org limits, or `limit=3` for reassessment, which is one batched `/fixtures?ids=` call per run). They can use more of their existing per-run allowance, never more than it. All of them stop 300 requests before the daily ceiling (paid reserve), so the VIP/Premium budget is untouched.

**Paid lease protection:** with early-run at :27/:57, the next lease user is ≥8 minutes away, longer than the 6-minute lease TTL. That guarantee is asserted in CI.

**Database load added**

| Source | Added queries | Frequency |
|---|---|---|
| Generation context (all lanes) | +1 `UpcomingFixture` range read, +1 `TeamEnrichmentCache` read by unique ids | per generation (~hundreds/day) |
| Early publication | +2 reads per 80-row page | 48 runs/day |
| Early odds / early run / leagues workload | +1 read each | per run |
| Telemetry | +1 upsert per dispatched request; +1 per repeat; +1 per budget refusal | ≤ daily request volume (≤7,500 at the configured limit) |

**Telemetry micro-benchmark (disposable local Postgres 16, not production).** 7,500 writes (a full day at the configured limit) through the real `recordApiOutcome`:
- 1.7 s total, about 0.23 ms per write;
- 7,500 of 7,500 increments counted, none lost under fire-and-forget concurrency;
- 1,440 distinct rows, about 0.5 MB including indexes;
- the budget check's `day = 'YYYY-MM-DD'` aggregate stayed at about 0.5 ms.

Production latency will differ. At ≤4 requests per second, the added write rate is negligible against the existing per-request budget upsert and aggregate. Row growth is about 1–3k rows/day (about 0.5–1M a year), so a 90-day retention prune is recommended (a DB delete, which needs owner approval).

### R2.5 Production evidence

Still blocked. This environment has no database or API-Football credentials, and the proxy refuses the production site. The seven-day tables remain *not measured*. To complete them, run the read-only commands in `EARLY_ENGINE_DEEP_AUDIT.md` §7 in an environment with production read access, or give this session read-only access.

---

## Review round 3: verified production usage (owner exports, 22 Nov 2026)

Source data and full tables: [API_FOOTBALL_7_DAY_USAGE_REPORT.md](API_FOOTBALL_7_DAY_USAGE_REPORT.md). All owner figures were recomputed from the CSVs and reproduce exactly: 47,262 requests over 15–21 Nov UTC, 6,751.7/day average, `/fixtures` 60.7%, `/odds` 9.9%, 136 quota/budget summaries.

### R3.1 What the verified data establishes

1. **The live-score snapshot is a quota filler, and it sets the daily total.** It spends everything above 1,000 remaining (at most one call per 15 s). Its target end-of-day level is 6,400 used; the lowest verified day is 6,421. On Nov 15–19, `/fixtures` moved opposite to the other endpoints (r = −0.64). Upper bound on live-score usage: 3,797/day.
2. **The early lane was shut out by that filler every day.** Early discovery needed 2,200 remaining (used ≤ 5,200); every verified day used 6,421–7,125. It stood down in 44 of 123 passes (35.8%; 28 of 48 on Nov 21). Early odds needed 1,800 and its stand-downs were silent, so its 0 quota flags are not evidence of no stand-downs.
3. **Early generation's 17 quota flags were a defect already fixed.** They came from a quota gate on a job that makes 0 API calls; PR #218 removed it on 21 Nov 11:36 WAT. Not caused by #227, not needing #227.
4. **VIP/Premium was never short of API budget.** Its 8 flags are its own paid attempt quota; no day reached its 7,370 stand-down. Ordinary generation stood down 3 times on Nov 20 (>6,900 used). The non-paid ceiling (7,100) was exceeded on Nov 20–21.
5. **The `/odds` rise is mostly not the early lane.** Early odds can account for at most 32 (Nov 20) and 192 (Nov 21) of +262 and +696 over the Nov 15–19 mean. The leading candidate is PR #217 extending odds checks to Goals generation from 20 Nov 18:35 UTC. That is unproven: the history has no per-job split.
6. **`/leagues` (5.3%) is avoidable churn**: season lists re-read every 6 h.

### R3.2 Does quota pressure prevent the early engine from processing or publishing?

| Stage | Affected? | Evidence | Status |
|---|---|---|---|
| Discovery (capture and queueing) | **Yes**: 35.8% of passes lost | JobRun keyword + threshold arithmetic | **Fixed in this PR** (threshold below the live floor) |
| Odds warming (needed for automatic publication) | **Yes**, silently, from 5,600 used daily | threshold arithmetic; summary had no keyword | **Fixed** (threshold + named stand-down) |
| Generation | Was (17 runs) | old code gate | Fixed by #218 |
| Publication | No direct effect (no provider calls) | code | Indirect: stale or absent quotes block automatic publication; addressed via odds |

### R3.3 API-saving opportunities (numerical; ranked by impact)

"Verified base" = the endpoint's measured 7-day average. Savings are **estimates** unless marked implemented, and none is presented as measured.

| # | Opportunity | Verified base | Estimated saving/day | Risk | Effect on VIP/Premium | Status |
|---|---|---|---|---|---|---|
| 1 | Live-score cadence: replace "spend everything above 1,000 at ≥15 s" with a fixed allowance or a slower floor | live ≤ 3,797/day (bound) | 30 s floor caps live at 2,880; 60 s at 1,440; a 1,500/day allowance caps at 1,500. Saving = current live usage − cap, **up to ~2,350/day (≈35% of usage)** if usage is near its bound | Scores refresh every 30–60 s instead of ~15–20 s while matches are live | none (paid reserve untouched) | **Needs your decision.** A product trade-off. Measure `site:live-snapshot` for 2–3 days first. |
| 2 | Season-list TTL 48 h away from season boundaries | `/leagues` 355 | **~150–270** | New season picked up ≤6 h late near boundaries (unchanged); no change mid-season | none | **Implemented** |
| 3 | Player leaderboards refreshed by matchday (or 24 h) instead of 12 h | 313 (3 boards) | **~156** (50%) | Key-player lists up to a day old on matchdays | none | Recommended |
| 4 | Insights: keep the existing "match finished" trigger, raise the age refetch from 6 h to 24 h | inside `/fixtures`, ≤ 2,880/day cap | up to 75% of insight fetches (absolute **unknown** until measured) | A match in an uncaptured competition is reflected up to 24 h later | none | Recommended after one day of `refresh-insights` telemetry |
| 5 | Derive enrichment's last-5 from a fresh insights history (last 20) instead of a second call | 183 (pinned) | ≤ **183** | Coupling two caches | none | Recommended (medium complexity) |
| 6 | Goals-pass odds lookups: reuse the ordinary lane's recent failed attempt instead of retrying every 6 h | part of the +230/+504 | not calculable from history | slightly fewer Goals price checks | none | Measure `generate-goals` `/odds` first |

### R3.4 How saved capacity can reach the early engine

**Today, without opportunity 1, a saving is re-spent on live scores.** The filler's budget is "remaining − 1,000", so freeing 200 `/leagues` calls just makes live scores refresh slightly faster. The threshold change in this PR is what lets the early lane use capacity at all: its bounded spend (≤ 384/day) now runs before the filler's floor instead of after it.

If you adopt opportunity 1 (say a 1,500/day live allowance), the freed capacity becomes real headroom. Options that would turn it into early coverage, each needing your approval because it raises early API spend:

| Use | Extra requests/day | Expected effect |
|---|---|---|
| Early odds warming 4 → 6 fixtures per pass (route already allows 6) | +96 | 50% more quote refreshes, aimed first at drafts a fresh quote would publish (#227 ordering) |
| Early discovery 4 → 6 leagues per pass | +96 | each CORE/SECONDARY league revisited 1.5× as often, so fixtures are captured earlier |
| Standings workload limit +2 per run (exact limit is set on cron-job.org) | about +2 × runs × 2 calls | fresher tables for queued early leagues (selective gate, evidence) |

### R3.5 Reconciliation with PR #227

| Verified issue | Addressed before this round? | This round |
|---|---|---|
| Early discovery shut out daily | **No**: the first-round report treated the 2,200 threshold as a legitimate control | Threshold → 750 below the live floor; replay on verified totals: 3/7 days affected late instead of 7/7 |
| Early odds silently shut out | No | Same threshold; stand-down named |
| Early generation quota gate | Fixed by #218 (pre-existing) | — |
| `/fixtures` 60.7% unexplained | Partly: telemetry would attribute routes, but homepage live-score renders would have been `unattributed` | Fetchers labelled at the source; filler mechanism documented with bound |
| `/odds` +262/+696 | No (yield ordering redistributes, adds nothing) | Lower-bound diagnostic added to the audit script; telemetry splits by job |
| `/leagues` churn | No | Boundary-aware TTL |
| Paid protection | Yes (lease timing, reserves) | Confirmed by data: no paid API stand-down in 7 days |
| Telemetry safety (`#h` keys) | Yes (budget sums use exact `day`; benchmarked) | unchanged |

**Not claimed:** none of this is proven in production. Validate over one post-deploy week:
- the early-discovery stand-down rate (expected near 0 on days under 6,650 used);
- the `/leagues` daily count (expected about 85–205, down from 355);
- the `site:live-snapshot` share;
- a per-job `/odds` split;
- unchanged VIP/Premium output.
