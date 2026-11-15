# Sprint 11: production validation, shadow monitoring and subscriber value

Evidence date: 15 Nov 2026, 08:13 UTC. The source is read-only audit run 43693408955 (`sprint11-production-audit.yml`), which runs `scripts/audit-sprint11.ts`, `measure-paid-performance.ts 60`, the alternative-market settlement and a screen.

Nothing was deployed, merged, activated or reconfigured, and no model request was made in this sprint.

> **The headline limitation:** Sprints 08–10 have been live for **8.1 hours**. Every prospective figure below covers that window only. Historical figures are labelled as historical and are never presented as results of the changes.

## 1. Production revision and deployment

| Fact | Evidence |
|---|---|
| Running image | `ghcr.io/voclain1/betgenius:9cbe65fd…`, the container's own `Config.Image` |
| Deployed tag | `APP_TAG=9cbe65fd1c23…`, master #199, a homepage change merged after Sprint 10 |
| #197 (`630349b`) and #198 (`74fb44a`) present | Both are ancestors of `9cbe65f`. The tree of the reviewed #197 branch (`6332d6c`) is identical to `630349b`. |
| Deploys | deploy-vps run 80 (630349b, 00:02 UTC) and run 81 (74fb44a, 00:04 UTC) both succeeded, and so did the later #199 deploy. Nothing was redeployed for this audit. |
| Health | `app` healthy with 0 restarts; `postgres` healthy; `ops` up 13h. `/` and `/api/health` return 200. 0 app log lines matching "error" in 6h. |
| Database | Read-only session verified (`transaction_read_only = on`) on every script |

## 2. Production configuration (running container, allowlisted names only)

| Setting | Value | Notes |
|---|---|---|
| `PAID_SPARE_QUOTA_WIDENING` | unset, so the code default **shadow** applies | Confirmed independently: 32 of 33 pass runs since deploy recorded `mode: "shadow"`, and none recorded `on` |
| `COVERAGE_ROLLOUT`, `PAID_QUALITY_POLICY`, `PAID_SELECTION_MODE`, `PAID_ROUTE_PRIMARY_PROVIDER`, `PAID_CALIBRATION_DISABLED` | unset (defaults) | |
| `API_FOOTBALL_*` limits | unset | Default daily limit 7,500 |
| `ANTHROPIC_MODEL` | unset | Default `claude-haiku-5-5`. It was the only model used since deploy (9 jobs). |
| `APP_ENV` | production | |

**Gap fixed in this PR:** the existing diagnostic probe did not report `PAID_SPARE_QUOTA_WIDENING`, so nobody could see whether spare quota was off, shadow or on.

## 3. Paid generation and publishing health

**JobRun, 7 days.** Every scheduled job ran with 0 failures, including since deploy:

| Job | Runs in 7 days | Runs since deploy |
|---|---|---|
| `generate-vip-premium` | 672 | 33 |
| `generate-ordinary` | 924 | 45 |
| `refresh-odds` | 672 | 32 |
| `settle` | 63 | 4 |
| `results-pass` | 897 | 44 |
| `paid-selection-shadow` | 32 | 8 |

**Generation failures.** There were 6 in 7 days, all `CertaintyLanguageError` and all resolved. There were 0 since deploy.

**Duplicate safeguards over 30 days:**
- 0 of 175 VIP fixtures had more than one published pick.
- 0 of 37 PREMIUM fixtures had more than one published pick.
- 0 ledger fixture ids had more than one SUCCEEDED row.

36 rows carry both VIP and PREMIUM. This is by design: PREMIUM is a strict subset of VIP (`vipPremiumPipeline.ts:686`).

**Dedicated publication.** All 77 dedicated promotions with a kickoff in the window were published. None was published after kickoff.

**Not verified here:**
- Entitlement and leak checks were not re-run. `verify-paid-production.ts` covers them and is unchanged.
- cron-job.org's own schedule is outside the repository. Its effect is visible through JobRun, which is consistent: the VIP pass runs every 15 minutes.

## 4. Double Chance correction

The signal is reconstructed on each fixture's cached quote:
- For past fixtures, the last pre-kickoff quote is used.
- The quote the pass actually saw at decision time is not stored, so this is a closing reference.
- The pre-fix behaviour is reproduced exactly by `legacyLopsidednessSignal`, which is tested.

| Covered fixtures with a usable quote (30 days + 48h) | CORE | WIDENED |
|---|---|---|
| Total | 421 | 607 |
| Unchanged by the fix | 245 | 401 |
| **Newly targetable** (75%+ only with the fix) | **77** | **88** |
| Away DC now the headline, already ≥ 75 under the old code | 7 | 8 |
| Away DC now the headline, still < 75 | 87 | 92 |

**Regression guard.** 0 fixtures changed to anything other than away Double Chance. The home Double Chance probability is identical under both codes. Where the old headline was home DC (758), 183 now headline away DC because that side is stronger. That leaves the home side's own value untouched.

| Funnel (newly targetable fixtures) | Historical baseline, kickoff before fix | Since fix (8.1h, incl. upcoming) |
|---|---|---|
| Newly targetable | 159 | 6 |
| Attempted by the dedicated pass | 1 | 2 |
| Drafts at 75+ | 1 | 0 |
| Promoted | 1 | 0 |
| Published dedicated | 1 | 0 |
| In VIP/PREMIUM by any route | 23 | 0 |

**The pass's own record.** Before the fix it logged 212 targets: 169 home DC, 17 MW Home, 26 MW Away and **0 away DC**. After the fix it logged 3 targets: 2 away DC and 1 home DC.

The 2 away-DC attempts were Belarus v Albania (signal 78.5) and Gibraltar v Malta (87.5). Each produced 2 drafts, and none reached 75 confidence (MODEL_BELOW_FLOOR). That is 2 model requests, about $0.01.

**Reading:** the fix works mechanically. Away favourites now enter the candidate pool and reach the model. Its value is unproven: **0 incremental published picks so far.**

Historically, 23 of the 159 newly targetable fixtures already reached VIP through the ordinary route. So at most about 136 per 30 days were genuinely unserved candidates, and the dedicated pass converts only a minority of attempts.

## 5. Spare-quota shadow

**Observed:** 8.1h, 33 pass runs, 32 shadow blocks and 0 runs in `on` mode.

| Item | Value |
|---|---|
| Spare slots by Lagos day (maximum seen) | 15 Nov: 2, 16 Nov: 1, 17 Nov: 8 |
| 17 Nov | Not yet inside the 30h day-end bound, so no core fixture is reserved yet |
| Eligible widened candidates | 0 |
| Would-be targets | 0 |
| Overhead | Cache reads only. No provider or api-football call. 4 odds calls, all for live targets. |

**Prospective result: 0 additional picks in 8.1h.** The Sprint 09 estimate of about 3.8 extra VIP picks a month is historical and is **not confirmed or refuted**. It needs about 30 days of shadow records to compare, with no activation decision before then.

The 24h admission and 30h day-end bounds behaved as specified: no candidate was admitted while core fixtures could still be discovered.

## 6. Alternative-market experiment (Sprint 10, cumulative caps)

| Item | Value |
|---|---|
| Ledger | 1/30 evaluations, 1/30 model requests, 0/40 api-football requests, $0.0030 of $0.30 |
| Paid publication | None, automatic or otherwise |
| Eligible fixtures, this sprint's screen at 08:14 UTC | 0 of 0 covered paid-scope fixtures 12–24h out |
| Model evaluations this sprint | 0 |
| VIP-qualified / PREMIUM-qualified | 1 / 0 (run 1) |
| Incremental | 1 |
| Rejected candidates (run 1 screen) | 13 |
| Settled | 0 |
| Pending | 1: Belgium v Italy, Over 1.5 @ 1.18, kickoff 15 Nov 19:45 UTC |

Belgium v Italy has not been played. It will be settled only from the stored final score of production rows on that fixture (`settle-alt-market-experiment.ts`), never inferred.

The screen found nothing eligible, so no billed run was requested. That follows the brief's rule against triggering runs with no eligible fixtures.

The pre-registered rule reads **NO_GO on the interim sample**: 1 incremental against a NO-GO threshold of ≤ 1. Discovery is not activated.

## 7. VIP/Premium quality (settled, each fixture once per tier, 30 days)

ROI is flat stakes. **The estimated ROI uses the last pre-kickoff cached median, a closing reference, not the price a subscriber saw.**

**Observed entry-price ROI cannot be computed.** No settled dedicated pick produced a verifiable publication price under `verifiedEntryPrice`, which requires an explicit pre-kickoff quote and confirmation timestamps. The cause is not established here, and finding it is a next action.

| Tier | Decided | Strike (95% CI) | Mean conf | Calib (conf − strike) | Gap to closing market | Est. ROI |
|---|---|---|---|---|---|---|
| Free, all | 1,396 | 73.4% (71–76) | 72.5 | −1.0 | +0.3 | −4.8% |
| Free, conf ≥ 75 | 521 | 78.1% (74–81) | 77.3 | −0.8 | +1.6 | −4.7% |
| VIP ordinary | 86 | 82.6% (73–89) | 76.5 | −6.0 | −0.6 | −1.6% |
| VIP dedicated | 75 | 81.3% (71–89) | 79.2 | −2.2 | −3.1 | −7.6% |
| PREMIUM | 37 | 86.5% (72–94) | 81.6 | −4.9 | −1.4 | −2.4% |
| Alternative-market | 0 | – | – | – | – | pending |

**Newer versus older (last 14 days against earlier):**
- Dedicated VIP improved from 76.9% to 86.1%, and its estimated ROI from −11.9% to −2.8%.
- PREMIUM held at 88% versus 85%, but on only 17 and 20 picks, which is anecdotal.

The 60-day `measure-paid-performance` view is consistent:

| Tier | Strike | Est. ROI |
|---|---|---|
| VIP | 82.9% | −1.2% |
| VIP dedicated | 83.7% | −4.1% |
| PREMIUM | 86.8% | +3.7% (71 priced) |
| Free | 71.2% | −6.1% |

**Conclusion:**
- Paid tiers strike measurably higher than free. VIP's CI of 78–87% is above free's 69–73% and above confidence-matched free at 75–81%.
- Paid picks are priced shorter: median about 1.17 against 1.31 for free.
- **Estimated ROI stays negative for every tier except a small PREMIUM 60-day positive whose interval spans zero.**

The newer data does not overturn the earlier conclusion of negative estimated ROI.

## 8. Dry days (past 29 full Lagos days)

3 days had no VIP or PREMIUM publication, and 10 had at most 2 paid fixtures.

| Day | First failing stage | Addressable without lowering bars? |
|---|---|---|
| 6 Nov | MARKET_QUALIFICATION_FAILURE: 2 targetable, 2 attempted, 1 draft at 75+ failed the gate | No |
| 9 Nov | TARGETING_EXCLUDED: only 1 fixture in paid scope, none at 75%+ | No: a thin calendar |
| 11 Nov | PROVIDER_OR_QUOTA_LIMITATION: 1 targetable, never attempted, 4 quota stand-downs in its window | **Yes:** scheduling or headroom |

The classification is mutually exclusive and tested (`classifyDryDay`). Inputs use closing-reference quotes.

None of these days is fixed by a lower confidence floor or a larger quota. The 11 Nov case is a single fixture.

## 9. Spending

**api-football.** Calls per UTC day, 7–14 Nov:

| Day | Calls |
|---|---|
| 7 Nov | 7,400 |
| 8 Nov | 7,400 |
| 9 Nov | 6,922 |
| 10 Nov | 6,792 |
| 11 Nov | 6,979 |
| 12 Nov | 6,736 |
| 13 Nov | 6,925 |
| 14 Nov | 6,801 |

The 7,400 days sit at the paid-priority ceiling, so **daily headroom is the binding constraint** on any new spend. On 15 Nov, 2,230 calls had been made by 08:13 UTC.

**Model.** 33–55 jobs a day, at an estimated $0.11–$0.19 a day. The VIP/Premium pass accounts for 0–12 jobs and ≤ $0.05 a day. Sprint 10's research spend in total is $0.003.

## 10. Limitations and missing evidence

- **8.1h of post-deploy observation.** No settled pick has passed through the Double Chance fix or spare quota yet.
- **Decision-time quotes are not stored.** Double Chance and dry-day reconstructions use the last pre-kickoff quote.
- **Observed entry prices are missing** for settled dedicated picks. Every ROI here is estimated from closing references.
- **Not checked:** the cron-job.org schedule, provider-side billing, and entitlement leak probes (`verify-paid-production.ts` was not run in this sprint).
- **Interval width.** Paid samples are 37–86 decided picks, so the Wilson intervals are 15–20pp wide.

## 11. GO / NO-GO

| Decision | Call | Expected benefit | Evidence | Risk | Cost | Rollback | Approval |
|---|---|---|---|---|---|---|---|
| Keep the DC fix live (already deployed) | **GO, continue** | Up to about 136 extra candidates a month reach the model. Published gains are unknown. | 2 attempts so far, 0 promoted | More quota spent on away favourites | About $0.005 per attempt, within the existing 8/day quota | Revert `sameSides` in `marketConfirmed.ts` | Already merged |
| Spare quota `on` | **NO-GO** | About 3.8 VIP a month (historical only) | 8.1h of shadow, 0 would-be targets | Takes slots from late core fixtures (mitigated by the 24h/30h bounds) | Pass quota only | Unset the flag (shadow) | Owner, after ≥ 30 days of shadow |
| Alternative-market discovery | **NO-GO** | Unknown | 1 evaluation, interim NO_GO | Low-priced Over 1.5 slate | n/a | n/a | Not requested |
| Further alternative-market runs | **Only when a screen lists eligible fixtures** | Sample growth | Cumulative ledger 1/30 | None | ≤ $0.30 in total | n/a | Explicit request per run |
| Lower floors or raise quotas | **NO-GO** | – | Dry-day causes are not floor-bound | Quality | – | – | – |

**Answer to the sprint question:**
- **Not yet shown.** The changes are live and behave as designed, but they have produced 0 additional qualifying paid picks in 8.1h.
- Paid tiers do deliver a higher strike rate than free.
- They show no measurable positive estimated return beyond free.
- About 30 days of post-deploy records, plus fixed entry-price evidence, are needed before either point can be settled.

## 12. Three highest-impact next actions

1. **Restore observed entry prices.** Find out why no settled dedicated pick passes `verifiedEntryPrice`, then fix where the evidence is written. Without it, subscriber value is only ever estimated.
2. **Re-run this audit at 7 and 30 days.** Dispatch `sprint11-production-audit`. At 30 days, compare spare-quota would-be targets against the 3.8/month estimate and count published away-DC picks as incremental.
3. **Settle Belgium v Italy after 15 Nov.** Screen before any further experiment run, using `alt-market-research` with job `screen`, and never request a billed run on an empty screen.

## Reproduce

- **Production audit:** dispatch `sprint11-production-audit` (read-only, no model key, no schedule).
- **Experiment screen:** `alt-market-research` with `job=screen`. No credential check is made and no model request is sent.
- **Checks:** `npx tsx scripts/check-sprint11-audit.ts` (40 checks) and `npm run check:alt-market-research` (70 checks).
