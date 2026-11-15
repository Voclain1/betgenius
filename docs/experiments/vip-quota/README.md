# Controlled VIP/Premium quota experiment v1

Base: master `35015264` (includes #201). **Disabled; merge, deploy and enable require owner approval. No production changes or paid requests were made to prepare this PR. No supply improvement is claimed.**

## Historical simulation, run before implementation

Source: read-only audit [43697810970](https://github.com/Voclain1/betgenius/actions/runs/43697810970), 15 November 2026. `historical-source.txt` contains the archived funnel and attempt-yield output, with no credentials or database connection details. The generated JSON records its SHA-256. Reproduce from repository root:

```
python3 scripts/simulate-vip-quota.py > /tmp/vip-quota.json
diff -u docs/experiments/vip-quota/historical-simulation.json /tmp/vip-quota.json
```

This is a **capacity upper-bound simulation**, not a point-in-time replay or evidence of promotion uplift. Closing quotes are not eligibility at generation time; unattempted fixtures have no model output, so qualification, publication, cost per promotion and settlement cannot be reconstructed. It would be misleading to invent those outcomes. No historical model calls were purchased.

| Cohort, Lagos kickoff days | Observed attempts (old policy) | Observed promotions | 8-attempt baseline capacity bound | Incremental capacity bound, max 16 |
|---|---:|---:|---:|---:|
| Core calendar, 1–8 Nov | 51 | 27 | 46 | 19 |
| International break, 9–14 Nov | 34 | 8 | 25 | 12 |

The JSON also contains explicit constraint sensitivities. If all eight baseline attempts use the same creation day, the unchanged 12-call cap reduces the core-calendar incremental bound from 19 to **11** and the break bound from 12 to **8**. With illustrative (unapproved) $0.10 daily funding and $0.028 full reservations, these become **9** and **6**. Applying the archived *final UTC-day* API snapshots as a stress case leaves **0** and **6** respectively: the rich core days had no remaining paid API headroom at those snapshots. Those snapshots cannot reconstruct availability earlier in the 12–48h window, but they show why API capacity is a real constraint, not free headroom. An unfunded or disabled experiment permits **zero** extra attempts.

Fixture-rich core days include 5 Nov (24 closing-lopsided fixtures, capacity 8→16) and 7 Nov (16, 8→16). The 8 Nov pool (11) contributes a further upper bound of 3. The historical actuals include creation-day accounting, including 17 attempts on 5 Nov; **they are not an observed unchanged-baseline control**. Closing-lopsided supply also excludes alternative-market outcomes on attempted fixtures whose closing headline later moved below 75. Thus these numbers must not be treated as forecasts or as a lower bound on supply.

The implementation is stricter than the simulation: fresh quotes during the existing 12–48h window, ordinary coverage, eligible scope, no prior attempt, and ten eligible fixtures across used slots plus the currently qualified pool are required. The unchanged 12-call **creation-day** cap, API headroom and the incremental model-cost budget can reduce capacity further. The often-cited estimate of seven promotions/$0.08 in #201 is not used as an experiment result or a spending guarantee.

## Controls and invariants

- Baseline: 8 attempts per Lagos kickoff day. Extra allowance is separate, opt-in, integer 1–8; absent/invalid controls leave the baseline quota unchanged. No confidence, EV, market, league, bookmaker, alternative-market, publication or access threshold changes.
- Rich-day activation: `used attempts + unique eligible unattempted fixtures >= 10` for that kickoff day. Eligibility is computed with the existing gate inputs and ranking; cache-only, no additional warming allowance. It is re-evaluated each run. This also allows a fixture-rich international-break day; such days must be analysed separately.
- Ranking stays earliest kickoff day, strongest market, league priority, kickoff, match key. No maximum favourite probability is introduced; >86.96% candidates remain eligible for sellable alternative markets.
- Total **creation-day** attempts remain capped at 12. A kickoff day can reach 16 only when attempts are spread across creation days and all budgets permit it. The worker rechecks this under its existing generation lease.
- `PaidQuotaAttempt` reserves the fixture permanently before an extra attempt. Its primary key prevents a concurrent or failed fixture being purchased again. Missing AIJobs still consume both kickoff-day and creation-day allowance. The reservation is not a retry token and is never deleted in normal operation.
- Cost budget is per Lagos **creation/spend day**, not kickoff day, summed across kickoff days, in integer micro-USD. Each extra attempt precharges the full conservative maximum: 200,000 input tokens plus the enforced 16,000 output tokens at explicitly attested rates. Prompt bytes are capped at 90,000 before transport. This is intentionally far above the historical average. **No refund**, including failures, parse errors, refusals, timeouts or missing usage. Actual provider-reported usage is recorded separately.
- Extra attempts support only the pinned `anthropic:claude-haiku-5-5` route, with SDK retries disabled. Any other primary/model, missing key, unpriced route, oversized prompt or expired attestation blocks extras. Fallback is blocked before transport; it cannot spend an unreserved request. Baseline provider order/retries are unchanged.
- Any model request without reliable usage blocks further extra reservations for its spend day. Reliable actual token use is also required to auto-publish an extra prediction. Fail-closed database errors stop work before spending. A process crash leaves the full reservation charged.
- API-Football ceiling stays 7,500/day UTC, and the existing reserves remain (default paid ceiling 7,400, ordinary 7,100). While the switch is `on`, **all application API dispatches** atomically reserve and increment the shared ledger under a short transaction lock; the hard ceiling is clamped to 7,500 even with a higher environment override. Tracking failure blocks dispatch. The transaction ends before any network call. The reserve still covers external consumers/drift; this app cannot control unrelated software using the same provider key. Deploy to all callers before enabling; mixed old/new workers do not share the new atomic reservation protocol.
- Publication rechecks all existing gates and requires the reservation, usage, immutable experiment attribution and total attempt position ≤8+configured allowance. The existing atomic publication transaction, kickoff check, quote evidence and notification dedupe remain in force. Turning the switch off holds extra drafts; no extra auto-publication continues after rollback.

## Proposed configuration (do not apply without approval)

Leave `VIP_QUOTA_EXPERIMENT` unset or `off` in production. No environment/deployment file is changed by this PR.

The owner must approve a duration, allowance, daily USD budget and **verify current provider pricing and context/output limits** before enabling. Supply all of:

| Variable | Required meaning |
|---|---|
| `VIP_QUOTA_EXPERIMENT` | Exact value `on` |
| `VIP_QUOTA_EXTRA_ATTEMPTS` | Integer 1–8, maximum total 16 per kickoff day |
| `VIP_QUOTA_INCREMENTAL_DAILY_USD` | Explicit incremental daily dollar ceiling, at least one full reservation |
| `VIP_QUOTA_INPUT_USD_PER_MILLION` | Verified positive rate for the exact pinned model and request class |
| `VIP_QUOTA_OUTPUT_USD_PER_MILLION` | Verified positive rate including billed thinking |
| `VIP_QUOTA_PRICE_VALID_UNTIL` | Explicit ISO instant, future and no more than 31 days away |

Existing `ANTHROPIC_API_KEY` must be configured. `ANTHROPIC_MODEL` must be unset or `claude-haiku-5-5`; `PAID_ROUTE_PRIMARY_PROVIDER` unset or `anthropic`. If production currently uses Gemini first, extras stand down; switching the baseline provider is outside this experiment. The dashboard's approximate zero-for-unknown pricing is never used as a spend authorization.

For arithmetic illustration only, at $0.10/$0.50 per million input/output tokens a reservation is $0.028. A $0.10 daily ceiling permits at most three extra attempts, even if all return cheap output. These are not approved prices or an approved budget. Re-attest before any provider price/model change. The flag alone cannot activate extras without valid cost controls.

## Production evaluation, after separate approval

1. Before enablement, capture at least 14 full baseline kickoff days with `measure-supply-funnel.ts`, `measure-attempt-yield.ts`, `measure-paid-performance.ts` and API UTC-day usage. Include rich club days and annotate the international-break calendar. Prefer matched weekdays/competitions; the old-policy audit above is context, not a causal control.
2. Pre-register a short window (suggested 14 full days, within price expiry), with rich days and break days analysed separately. Keep all other paid flags, provider routing, schedules and qualification policies fixed. Stop on any integrity failure, unknown model cost, pricing change or API accounting problem. No automatic continuation or budget top-up.
3. Run the report with **read-only session settings**, not just a read-only promise:

```
REQUIRE_READ_ONLY=1 VIP_QUOTA_BREAK_DAYS=2026-11-09,2026-11-10 \
  npx tsx scripts/report-vip-quota-experiment.ts 30
```

`DATABASE_URL` must include PostgreSQL options `-c default_transaction_read_only=on`. The script verifies `SHOW transaction_read_only` and refuses writable sessions. Set the break-day list to the actual evaluation calendar; core-free unlabelled days are explicitly unclassified. No providers are imported or called by the report.

4. Report **extra attempts reserved**, actual extra model requests, distinct VIP-or-better promotions, PREMIUM subset, publications, incremental recorded cost (null if incomplete), conservative reserved cost, marginal USD per qualifying fixture, additional metered API reservations and total API use by UTC day. Distinguish held/failed reservations from requests. Compare the first-eight baseline arm separately; same-period extra-vs-baseline attribution is not randomized causal uplift because ranking assigns stronger fixtures first.
5. Check duplicate paid publications, post-kickoff publications and notification/entry-price integrity using the existing paid invariant and publication diagnostics, in addition to the new report. Settled wins/losses/void/pending and Brier calibration appear when available; rerun existing paid-performance analysis for price-based returns and market-relative calibration. No unsettled result is counted as a win, and no incomplete cost denominator is presented as a complete marginal cost.
6. Supply improvement can only be claimed from observed production results, with sample size, matched baseline and calendar caveats. No such results exist for this disabled PR.

## Deployment prerequisites and rollback

Only after review/approval: apply the additive `PaidQuotaAttempt` schema to the intended database with the project's normal schema workflow, regenerate Prisma and deploy the reviewed code **with the flag off**. Confirm schema sync, baseline targeting, gate and publication health. The new CI workflow uses a disposable local PostgreSQL service and no production/model credentials.

After separate approval to enable, configure the chosen controls on all app callers. Verify the active environment, price expiry and cost reservation before accepting any extra request. Do not raise `API_FOOTBALL_DAILY_LIMIT`, reserves or the 12-call daily cap.

Rollback immediately by setting `VIP_QUOTA_EXPERIMENT=off` (or unsetting it) on every instance and restarting through the normal approved operational process. Existing baseline behavior and eight-attempt publication ceiling return. Extra pending drafts stay held; do not manually publish them to bypass the rollback. Retain reservations and AIJobs for audit; never delete them to regain spend or retry fixtures. Reverting this PR's code is also safe once the switch is off; the additive table can remain. Already published picks and settlement evidence must remain intact. No schema drop, bulk data deletion or retroactive publication is part of rollback.

## Validation

See `validation.md` for completed local checks. All database writes during preparation target disposable local Docker PostgreSQL databases. No experiment has been enabled in a deployed environment.
