# VIP/Premium Sprint 08: qualification loosening and coverage activation (14 Nov 2026)

**Outcome.** This sprint delivers an audit and tooling. It makes **no production code change**.

- No loosening candidate met the pre-registered promotion rule, so none was scored on the holdout.
- The evaluation lane has about 24 hours of shadow record, which is not enough evidence to activate it.
- The lane also cannot add a single VIP or Premium pick, because none of its competitions is in the paid scope.

Everything below is reproducible from read-only runs.

| Run | What it is |
|---|---|
| `diagnose-generation` **43645514487** (run 46, master `ec91436`) | The baseline named in the brief |
| `diagnose-generation` **43647880663** (run 47, this branch `f61a0b6`, job `qualification`) | This sprint's new measurements |

Both runs used a database session that the scripts verify is `transaction_read_only = on`.

- Run 47 made no provider calls. Its provider-spending `league-coverage` job was skipped with `qualification_only=true`.
- Nothing was written to production.
- No flag, cron, schedule or environment variable was changed.

The candidate policies, the split and the promotion rule were committed in `f61a0b6` **before** run 47 read any data. They live in `src/lib/qualificationResearch.ts`.

Reproduce:

```
npm run measure:qualification-funnel -- 14
npm run research:qualification-loosening -- 150
# or: Actions → diagnose-generation → Run workflow (days=14, qualification_only=true)
```

## 1. Production configuration, verified (not inferred)

The `qualification` job read the running container over SSH:

- `docker exec <app> printenv <NAME>`, for an allowlist of non-secret flag names only;
- plus `APP_TAG` from `/opt/betgenius/deploy.env`.

| Item | Repository default | **Production (running container)** |
|---|---|---|
| Deployed code | — | `APP_TAG=ec91436` = current master (Sprint 05 lane and Sprint 07/09 included). Container started 2026-11-14 20:59 UTC |
| `COVERAGE_ROLLOUT` | unset → `shadow` | **unset** (not in `app.env`) → `shadow`. Confirmed by behaviour: the discovery JobRuns carry `coverage.lane.rollout = "shadow"` |
| `PAID_SELECTION_MODE` | unset → `shadow` | **unset** → `shadow`. The live decision is the #175 rule; 22 shadow records since deploy, all `shadow/current` |
| `PAID_QUALITY_POLICY` | unset → `shadow` | **unset** → `shadow` (record only) |
| `PAID_ROUTE_PRIMARY_PROVIDER` | unset | **unset**. The 13 Nov option to lead paid generation with Gemini is not enabled |
| `PAID_CALIBRATION_DISABLED`, `PAID_VALUE_MIN_EV_LOWER` | unset | unset. Calibration artifact `cal-20261113-1` is inactive in deployed code (run 46 `verify-paid-production`) |
| `API_FOOTBALL_DAILY_LIMIT` / `_RESERVE` / `_PAID_RESERVE` | 7500 / 100 / 300 | **unset** → the defaults apply |
| `OPS_RECOVERY_MODE` | unset (preview only) | unset |
| `GEMINI_MODEL` / `GROQ_MODEL` / `ANTHROPIC_MODEL` | — | `gemini-3.7-flash` / `openai/gpt-oss-120b` / unset (code default) |

The external cron-job.org schedule is not in the repository and was not verified, as in Sprint 07. JobRun cadence shows that the jobs that matter here run:

- the paid pass about every 15 minutes (1,342 runs in 14 days);
- settlement and curation 126 times in 14 days.

## 2. Qualification rules actually active

**Ordinary curation** (`geniusCuration.planCuration` + `paidSelection.assessPaidCuration`, runs with settlement)

- VIP: confidence ≥ **75**. PREMIUM: confidence ≥ **80**. Both are hard floors.
- Only picks generated on the VIP calibration route are eligible (provenance `VIP_ROUTE_CONFIRMED`, core competitions). A usable quote may veto a pick at a model–market gap > 10pp. Unpriced route picks stay eligible.
- On a thin day (fewer than 3 core fixtures), a widened-scope pick at the floor is admitted only when the market confirms it: ≥ 5 books, market 75–87% (PREMIUM 80–87%), gap ≤ 10pp.
- One pick per fixture, at most 15 per day, at least 1h before kickoff, admission only.

**Dedicated pass** (`vipPremiumPipeline`, `?vipPremium=1`)

- Targets fixtures that ordinary generation already covered, where the market favourite is ≥ 75% de-vigged.
- One model call per attempt.
- The gate requires: model ≥ 75, market 75–87%, gap ≤ 10pp, ≥ 5 books, a quote less than 2h old, and not a repeat of a free pick.
- PREMIUM additionally needs model ≥ 80 **and** market ≥ 80.
- Quota: 8 attempts per kickoff day, 12 model calls per calendar day. Auto-published.

**Published copy binds the confidence floors.** These pages state them as a promise to subscribers:

- `PaidFeedCover`: "Every {tier} pick clears {floor}% confidence or better".
- `/predictions/[category]` metadata: "every pick clears 75%/80% confidence".
- `categoryPredictions`: "each rated 75% / 80% confidence or higher".

Lowering a floor therefore also changes subscriber-facing terms. That is the owner's decision, separate from any evidence.

## 3. Phase 2: the funnel in unique fixtures (kickoffs 31 Oct – 14 Nov, 14 days)

The dedicated pass's own JobRun funnel counts fixture-runs, not fixtures: 42,751 "covered" in 14 days. The table below counts **each fixture once**, by Lagos kickoff day.

| | Fixtures |
|---|---|
| Discovered (ledger) / succeeded | 530 / 520 |
| With any generated prediction | 565 |
| With a pre-kickoff quote from 5+ books | 555 |
| Best published single ≥ 80 / 75–79 / 70–74 / < 70 | 30 / 79 / 184 / 156 |
| **VIP fixtures published**: ordinary-only / dedicated | **49**: 13 / 36 |
| **PREMIUM fixtures published** | **20** (all dedicated) |
| Days with ≥ 1 VIP / ≥ 1 PREMIUM | 11 of 14 / 9 of 14 |
| Duplicate VIP rows on one fixture | 0 |

**Reconciliation.** These counts match `measure-vip-premium` §3 (run 46), the published feed records by kickoff day, exactly:

- VIP dedicated: 36 = 5+1+1+3+10+4+3+5+2+2;
- VIP ordinary: 13;
- PREMIUM: 20.

**First rule that kept a fixture out of VIP** (`firstLoss`, applied in rule order):

| Loss | Fixtures | Note |
|---|---|---|
| **CONFIDENCE** (paid scope, no published single ≥ 75) | **237** | The dominant loss |
| NO_PUBLISHED_SINGLE (generated, nothing single published) | 125 | Combos-only, review, archived |
| OUT_OF_PAID_SCOPE | 120 | 17 of them had a ≥ 75 pick with a 5+ book quote; they are excluded by design |
| NOT_VIP_ROUTE_ON_HEALTHY_DAY | 35 | ≥ 75 picks from SECONDARY / national-team leagues on a healthy day |
| NO_USABLE_PRICE / MARKET_OUTSIDE_BAND | 6 / 2 | Thin days only |
| MODEL_MARKET_DISAGREE | 0 | `marketDisagreeExcluded` is 0 in all 126 curation runs |
| PAID | 49 | |

- **Blocked by confidence alone:** 37 fixtures in 14 days (2.6 a day). These are paid-scope fixtures whose best 70–74 pick the market confirms on the gate's own terms. They are the most a floor cut could reach.
- **Widened-day admissions** by ordinary curation since 13 Nov: 1.
- **Lead time:** no fixture was lost to lead time. In run 46 `leadtime`:
  - generation inside 12h happened only for lanes that bypass discovery (Welsh, Banker);
  - published after kickoff: 0;
  - publication lead for dedicated picks: median 23.9h, p10 16.9h.

**Dedicated pass, unique fixtures**

- Of 205 drafts in the window, **134 (65%) were below the 75 model floor**: 63 below 65, 26 at 65–69, 28 at 70–72, 17 at 73–74.
- The gate's rejections in run 46: `MODEL_BELOW_FLOOR` 127 of 159.
- The market is not the bottleneck for this pass. The model's confidence is.

**Quotas and API budget.** Are they genuinely preventing otherwise-qualified selections? The evidence says no, with one bounded exception.

- **API usage.** api-football reached the ceiling on 9 of 15 UTC days: 7,400 of 7,500, with `/fixtures` taking 55–70%.
  - The paid pass stood down for budget 56 times in 14 days, all between 19:00 and 23:59 UTC (20:00–00:59 Lagos), when the next kickoff day's quota resets an hour later.
  - Paid picks published with under 2h to kickoff: 0. Published after kickoff: 0.
  - No measured case shows a qualified fixture reaching kickoff unattempted because of the budget.
- **The dedicated 8-per-kickoff-day quota** was fully used on 6 of 13 days. "Quota already spent" accounts for 329 stand-downs in 30 days.
  - Extra attempts convert at the observed rate: 33 promotions from 94 targets (about 35%), with 65% of drafts below the floor.
  - The 13 Nov sprint already labelled the quota change experimental. Its yield needs live model calls; it was not changed here.
- **Shared budget.** The **evaluation lane is quota-gated**: it needs 2,000 calls remaining, i.e. no more than 5,400 used. It skipped 20 of the 26 lane opportunities that were not lease-held.

## 4. Phase 3: bounded loosening, pre-registered

**Universe**

- 3,136 rows over 150 days:
  - 3,008 settled published singles at confidence ≥ 70;
  - 128 dedicated drafts archived for `MODEL_BELOW_FLOOR` (confidence < 75), resolved from a settled sibling's final score. Six could not be resolved.
- Rejected drafts at ≥ 75 are excluded: their rejection depended on a quote that was not kept.

**Periods**

| Period | Rows | Kickoffs |
|---|---|---|
| dev-train | 1,567 | before 6 Oct |
| dev-validate | 625 | 6 Oct – 21 Oct |
| final holdout | 944 | from 21 Oct 19:00 |

**Discipline**

- Fixture-level deduplication: one pick per fixture per policy.
- A fixture that already carries a paid pick cannot get another.
- Returns use the recorded entry price, else the last pre-kickoff quote. 68 post-kickoff quotes were discarded.

**Promotion rule**, fixed in `f61a0b6`, judged on the **added** picks on dev-validate, with dev-train as a sign check:

- ≥ 30 added;
- strike within 3pp of the baseline;
- closing-reference ROI within 1pp of the baseline;
- model Brier no more than 0.02 above the market's;
- ≥ +0.25 unique picks per active day.

**Baseline**, fixture-deduplicated:

| | n | Strike (95% Wilson) | ROI [90% bootstrap] | Brier model / market | Picks per day | Zero days |
|---|---|---|---|---|---|---|
| VIP dev-train | 297 | 77.4% (72.3–81.8) | −4.6% [−10.3, 1.1] | 0.172 / 0.158 | 6.46 | 18 of 46 |
| VIP dev-validate | 80 | 82.1% (72.1–89.0) | −3.7% [−14.9, 6.8] | 0.167 / 0.141 | 5.00 | 4 of 16 |
| VIP holdout (reported, not used for selection) | 138 | 83.2% (76.1–88.5) | −2.6% [−9.6, 3.8] | 0.142 / 0.134 | 5.52 | 3 of 25 |
| PREMIUM holdout | 35 | 88.6% (74.0–95.5) | +0.1% [−10.1, 9.8] | 0.107 / 0.100 | 1.40 | 9 of 25 |

**Added picks only**

| Candidate | Lowers a published floor | dev-train added | dev-validate added | Decision |
|---|---|---|---|---|
| V1: 73–74, market-confirmed (75–87%, ≥ 5 books, gap ≤ 10) | yes | 38, 78.9%, −6.1% | 15, 93.3%, n<30 | Not promoted: n; dev-train ROI 1.5pp below baseline; Brier |
| V2: 70–74, market-confirmed | yes | 61, 82.0%, −2.0% | 20, 90.0%, n<30 | Not promoted: dev-validate n 20 < 30 |
| V3: 70–74, market 80–87% | yes | 22, 77.3% | 7, 100% | Not promoted: n |
| **V4**: ≥ 75, market-confirmed, any paid-scope day (scope only) | no | 87, 77.0%, **−10.4%** | 50, 78.0%, **−9.7%** | **Fails on quality**: strike 4.1pp below the baseline; ROI about 6pp below the baseline in both periods |
| **V5**: V4 with gap ≤ 15pp | no | 90, 76.7%, **−10.9%** | 53, 79.2%, **−8.6%** | **Fails on quality** |
| P1: PREMIUM at 78–79, market 80–87% | yes | 0 | 9 | Not promoted: n |
| P2: PREMIUM = VIP with market 83–87% | yes | 1 | 9 | Not promoted: n |
| P3: PREMIUM ≥ 80, market 80–87%, any paid-scope day | no | 12 | 0 | Not promoted: n |

What this says, plainly:

- **The two candidates that keep the published floors make the feed worse.** Admitting market-confirmed ≥ 75 picks outside the VIP route on healthy days (V4/V5) adds about 2–3 picks a day.
  - Those picks strike 77–79% at a median price around 1.17.
  - They lose about 10% at closing reference in both development periods.
  - The current route restriction is doing useful work.
  - This agrees with Sprint 05's EXPANDED_COVERAGE finding.
- **Floor cuts look promising but are unproven.**
  - V2's additions out-performed the baseline in both development periods: 82.0% and −2.0% on 61 picks; 90% on 20 picks.
  - But dev-validate has only 20 additions, under the pre-registered 30.
  - V1 failed the dev-train sign check.
  - All development data is **Gemini-era**: 2,069 of 2,192 dev rows, with no Anthropic rows. Production has been Claude-primary since 31 Oct, and its confidence scale is lower (13 Nov audit: the share of picks at 75+ fell from about 50% to about 6%).
  - A floor rule fitted on Gemini's scale would be applied to a different scale. That is a regime shift this data cannot test.
- **Confidence is weakly ordered below 75.** Development, paid scope:

  | Confidence | Strike | ROI |
  |---|---|---|
  | 70–72 | 68.7% | −3.7% |
  | 73–74 | 71.3% | −8.0% |
  | 75–77 | 75.0% | −6.8% |
  | 78–79 | 78.6% | −7.5% |
  | 80+ | 84.9% | +2.3% |

  Only the 80+ band shows information beyond the price (model Brier 0.123 vs market 0.129). The 70–79 bands are priced correctly by the market and lose the margin.
- **Missing-price sensitivity.** The baseline is −27.6% if all 94 unpriced VIP dev picks had lost. Every candidate's additions are priced by construction, at −1.8% to −10.1%.

**Decision: retain the existing VIP and PREMIUM qualification rules.** No candidate is scored on the holdout. The holdout stays unused for these hypotheses.

## 5. Phase 4: coverage expansion end to end

| Stage | Finding |
|---|---|
| Registry / audit | 31 INCLUDE decisions (13 Nov evidence). **Re-audit 14 Nov (run 46):** 21 still INCLUDE. 7 are WATCH only because they had no fixture in the 2-day window (Uzbekistan, Denmark 3. Division, Scotland L1/L2, Turkey 2. Lig, Wales FAW Championship, SAFF). **3 fell to THIN_BOOKMAKER_MARKET with 0 sampled books:** Tunisia Ligue 2 (828), Montenegro Second League (356), Slovenia 3. SNL East (794). 9 competitions not in the stored list became INCLUDE. One 2-day snapshot per competition is not a stable basis |
| Discovery → lane | The lane code reached production with `ec91436`. **First lane record 13 Nov 22:32 UTC**, so about 24 hours of evidence. 96 lane-eligible discovery runs: 6 ran, 70 lease-held, 20 skipped for quota (fewer than 2,000 calls left). 12 provider calls. 66 unique fixtures shortlisted across all 32 lane competitions. **0 queued (shadow).** |
| Price evidence | **Shortlisted rows already priced at 5+ books from cache: 0 of 66.** This is structural. In shadow the lane makes no odds call, and nothing else prices uncatalogued fixtures. So the activation criterion Sprint 05 named ("the share priced at 5 or more books" in `coverage.lane`) **cannot be measured in shadow mode**. Today the only price evidence is the global-audit probe's 1-fixture bookmaker samples |
| Generation / paid scope | **None of the 32 lane competitions is in `PAID_ANY_LEAGUE_IDS`** (verified in code). Lane fixtures generate PENDING_REVIEW free picks only. **Activating the lane cannot add a VIP or PREMIUM pick**, by design, and Sprint 05 rejected widening the paid scope for lack of evidence |
| Publication | Unchanged. Ordinary rows need review; no lane fixture is auto-published |
| Welsh corrections | 112 (Welsh Cup) is marked priced and is in the lane: 3 fixtures shortlisted. 111 (FAW Championship) is in the lane: 1 shortlisted. The provider probe sampled 0 books on two FAW Championship fixtures a week out and 6 on the Welsh Cup tie (run 46). Wales stays DEEP_FALLBACK; no Welsh competition is paid-eligible |

**Cost if activated** (Sprint 05's bound, unchanged):

- the lane adds ≤ 40 calls a day, plus normal generation for ≤ 8 fixtures a day, at about 5–10 calls each;
- that is ≤ 120 calls a day in total.

That is affordable only on days that are not at the ceiling: 9 of 15 recent days were at the ceiling. On those days the lane's own 2,000-call guard stops it, and generation stands down once the budget is gone.

## 6. GO / NO-GO

| Proposed activation | Decision | Why |
|---|---|---|
| Lower the VIP floor (V1/V2/V3) | **NO-GO** | Not promoted. Under-sampled on dev-validate. Development data predates the current primary model's confidence scale. It changes published subscriber copy |
| Admit market-confirmed ≥ 75 picks outside the VIP route on healthy days (V4/V5) | **NO-GO** | Worse strike and about −10% closing-reference ROI on the additions, in both development periods |
| Lower the PREMIUM floor or make PREMIUM market-led (P1/P2/P3) | **NO-GO** | 0–12 additions per period: no evidence either way |
| Looser model–market gap (V5) | **NO-GO** | As V4 |
| `COVERAGE_ROLLOUT=on` | **NO-GO (stay shadow)** | 24h of lane record against the 2 weeks Sprint 05 required. The price-share criterion cannot be measured in shadow (0 of 66 priced from cache). 3 of 31 inclusions failed a re-probe. Even when activated it adds no VIP/PREMIUM supply |
| `PAID_ROUTE_PRIMARY_PROVIDER=gemini` | Not evaluated here (owner's decision, 13 Nov) | It is the one lever aimed at the measured bottleneck: 65% of dedicated drafts below the model floor since the provider switch. The 84 ABANDONED ledger rows in 30 days show Gemini failing on "prepayment" (run 46). Check Gemini credit before considering it |

## 7. What would make each decision revisitable

- **Floors.** Repeat `research-qualification-loosening` once there are at least 4 weeks of **Claude-era** settled rows, about mid-December. Use a fresh split that starts after 31 Oct, and pre-register again before reading. Any floor change also needs a copy and terms change approved by the owner.
- **Lane.**
  - Collect 2 weeks of `coverage.lane`.
  - Re-run the global audit (`league-coverage` job) weekly. Inclusions are stable only after 3 consistent audits.
  - For a price-share measure, either accept the audit's samples or approve a bounded shadow odds sample: ≤ 1 call per run, ≤ 8 a day. That is a code change not made here.
  - Activation adds free coverage only.
- **Supply.** The measured binding constraint is model confidence on the dedicated pass. The API budget at ceiling on most days is a second, shared constraint: 55–70% of calls go to `/fixtures`.

## 8. Changes in this PR

No production behaviour changes.

| File | Change | Production path? |
|---|---|---|
| `src/lib/qualificationResearch.ts` | Pre-registered candidates, statistics, promotion rule, funnel attribution | **No.** Pure. A check asserts that no file under `src/` imports it |
| `scripts/research-qualification-loosening.ts` | Phase 3 research | Read-only script |
| `scripts/measure-qualification-funnel.ts` | Phase 2 funnel, lane record, API budget | Read-only script |
| `scripts/check-qualification-research.ts` | 72 synthetic checks | Test |
| `.github/workflows/diagnose-generation.yml` | New `qualification` job; `qualification_only` input to skip the provider-spending job | Diagnostics only. Read-only DB, allowlisted env probe |
| `.github/workflows/league-coverage-quality.yml`, `package.json` | Run the new check in CI; npm aliases | CI |
| this document | Evidence | — |

## 9. Verification

| Check | Result |
|---|---|
| `check:qualification-research` (new) | 72/72: constants pinned to the production gate; candidates admit only what they state; fixture dedup and superset property; no duplicate paid pick; statistics, bootstrap, Brier, missing-price sensitivity; promotion and holdout rules; funnel attribution order; split without leakage; isolation from `src/`; read-only scripts; allowlisted probe |
| `check:league-coverage-quality`, `check:adaptive-coverage`, `check:european-clubs`, `check-generation` (138) | pass |
| `check:vip-premium-overlay`, `check:paid-selection`, `check:paid-value-integration`, `check:paid-market-quality` | pass |
| `check:paid-subscriber`, `check:paid-render`, `check:subscription-entitlement`, `check:paystack-entitlement`, `check:onetime-fallback` | pass: subscriber access unchanged |
| `check-certainty-language` | pass |
| `tsc --noEmit` | clean |
| Production probes (run 46 `verify-paid-production`) | Paid picks after kickoff 0; under 2h 0; duplicate fixtures in VIP/PREMIUM 0; anonymous leak probe all PASS; settlement lag median 2.1h |

## 10. Deployment and rollback

- **Deploy:** nothing to deploy. Merging adds scripts, a workflow job and a research module that production never imports. No schema change, migration, environment variable, cron or provider-call change.
- **Rollback:** revert the merge commit. Nothing in production depends on it.
- **Shadow cannot silently become active.** No code path reads the research module. `COVERAGE_ROLLOUT` is unset in production. `PAID_QUALITY_POLICY` has no `on` value. `PAID_SELECTION_MODE=value` requires an active calibration, and the deployed one is inactive.

## 11. Limitations and missing evidence

- **No entry-price archive.** Except for dedicated picks' frozen quote, returns are at a closing reference.
- **The confidence-floor analysis cannot see the current model's scale.** Development data is Gemini-era.
- **Rejected dedicated drafts at ≥ 75 are excluded.** Their market at gate time was not stored. Storing the gate's verdict on archived drafts would make the dedicated pass's own floor testable at entry price.
- **Funnel losses read the last pre-kickoff quote,** not the quote curation read at the time.
- **The lane's evidence is 24 hours.** Its price-share criterion is unmeasurable in shadow.
- **Sample sizes.** PREMIUM samples are too small for any PREMIUM rule (dev-validate baseline: 15).
- **External scheduler.** The cron-job.org configuration remains unverified.
