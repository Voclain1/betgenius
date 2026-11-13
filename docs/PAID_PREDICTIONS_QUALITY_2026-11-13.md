# Paid predictions: quality and reliability sprint (13 Nov 2026)

Evidence comes from production, read through the read-only `diagnose-generation`
workflow (job `paid-performance`; the session is checked as
`transaction_read_only = on` before anything runs). Reproduce with:

```
npm run measure:paid-performance -- 90 2026-11-13   # history, calibration, settlement, one day in detail
npm run backtest:paid-selection -- 90               # current vs proposed curation, chronological split
```

Prices: `Prediction.odds` is stored null, so the price is the fixture's cached
quote — the **median** across books (never the best), and only a quote taken
**before kickoff**. `FixtureOddsCache` keeps one row per fixture (the last
pre-kickoff quote), so ROI is at a near-closing median price. 130 quotes taken
after kickoff were dropped rather than used. No closing-line archive exists, so
CLV is only measurable for dedicated paid picks (entry = the de-vigged market
frozen at promotion).

## 1. What the paid categories are

| Feed | How a pick gets in |
|---|---|
| **VIP** | (a) Dedicated pass (`?vipPremium=1`, every 15 min): fixtures ordinary generation already covered, market favourite at ≥75% de-vigged, one model call (multi-market, "lower-risk" prompt), gate: model ≥75, market 75–87%, model–market gap ≤10pp, ≥5 books, quote <2h, not a repeat of a free pick; auto-published. (b) Ordinary curation (with settlement, every 3h): published VIP-route picks (core competitions) at confidence ≥75, one per fixture, max 15. |
| **PREMIUM** | Same two paths at model ≥80 and, for dedicated picks, market ≥80. PREMIUM picks are also VIP. |
| BANKER / GENIUS / GOALS | Free feeds, for comparison. |

## 2. Verified root causes of thin VIP days (13 Nov: two picks at 1.10 and 1.15)

1. **The primary model's confidence scale dropped below the paid floors.** Since
   Claude Haiku became primary (#150, 31 Oct) the share of ordinary picks at 75%+
   fell from ~50% (Gemini, every week Aug–Oct) to **5.9–6.7%**. VIP-route picks at
   75%+: **57 of 95** in the week of 26 Oct → **6 of 141** in the week of 2 Nov →
   **0** since. The floors (75/80) were measured on Gemini's output. On the same
   rows Claude's error against the market is no worse than Gemini's (model − market
   Brier +0.01 vs +0.02), so this is a confidence-scale shift, **not shown to be a
   skill difference**. Claude's core-league picks did settle worse (61.0% vs 76.0%,
   ROI −18.3% vs −5.7%), but at longer prices in fixtures the market also found
   harder (market Brier 0.22 vs 0.16) — confounded, not proof.
2. **13 Nov was a genuine low-opportunity day.** International break: 42 singles,
   all AFCON qualifiers, Nations League, Welsh Cup, NPFL, Frauen-Bundesliga. Zero
   VIP-route rows, so ordinary curation could contribute nothing; VIP rested on the
   dedicated pass alone.
3. **The dedicated pass spent its quota in a midnight burst.** The 8 attempts of
   Lagos 13 Nov ran 00:05–02:35, four on 14 Nov fixtures; the pass then stood down
   on **75 runs**. Over 30 days, 153 of 191 attempts went to later days' fixtures.
4. **The gate's pass rate is low by construction.** 11 attempts on 13 Nov fixtures
   → 2 promotions. Rejections over 12–13 Nov: `MODEL_BELOW_FLOOR` 22, `MARKET_BELOW_FLOOR` 6,
   `GAP_TOO_WIDE` 1. The 75–87% market band means a dedicated pick is always priced
   ~1.10–1.30: **low odds are the design, not a fault.**

Not causes (checked): discovery (24/24 fixtures for 13 Nov reached `SUCCEEDED`),
odds freshness for curation, duplicate handling, settlement.

## 3. Historical performance (kickoffs 15 Aug – 13 Nov, 90 days)

Flat 1 unit at the median pre-kickoff price; strike over decided picks; 95% Wilson CI.

| Feed | n | W/L/V | Strike (95% CI) | Median odds | ROI | Max DD | Longest losing run | Brier model / market |
|---|---|---|---|---|---|---|---|---|
| VIP | 517 | 403/103/4 | 79.6% (76–83) | 1.19 | **−3.1%** (n=426) | 15.5u | 4 | 0.16 / 0.15 |
|  VIP · dedicated | 106 | 84/18/4 | 82.4% (74–89) | 1.14 | −5.4% | 6.4u | 3 | 0.15 / 0.14 |
|  VIP · ordinary | 411 | 319/85/0 | 79.0% (75–83) | 1.22 | −2.4% | 11.1u | 4 | 0.16 / 0.15 |
| PREMIUM | 336 | 263/70/0 | 79.0% (74–83) | 1.19 | −2.9% | 12.1u | 4 | 0.16 / 0.15 |
| BANKER | 399 | 294/97/1 | 75.2% (71–79) | 1.22 | −3.9% | 14.6u | 3 | 0.18 / 0.17 |
| GENIUS | 926 | 687/224/3 | 75.4% (73–78) | 1.23 | −2.9% | 32.3u | 5 | 0.18 / 0.16 |
| All free singles | 3363 | 2345/958/6 | 71.0% (69–73) | 1.33 | −6.2% | 162u | 6 | 0.20 / 0.19 |
| Free, conf ≥75, not in VIP | 1184 | 910/263/1 | 77.6% (75–80) | 1.22 | −4.3% | 42u | 4 | 0.17 / 0.17 |

What this says, plainly:

- **No feed is profitable at median prices.** The de-vigged market is the better
  forecaster everywhere (lower Brier). A high strike rate at 1.19 is not value.
- **Paid vs free:** VIP beats all free singles (79.6% vs 71.0%, −3.1% vs −6.2%), but
  against free picks at the same confidence it is only ~2pp better on strike, inside
  the uncertainty. Paid picks are safer, not demonstrably more valuable.
- **CLV** of dedicated picks: +0.4pp (n=106) — indistinguishable from zero.
- **Longer prices lose most.** VIP by odds band: <1.20 −0.2% (n=221, 89% strike);
  1.20–1.34 −8.1% (n=117); 1.35–1.49 +13.2% (n=41); **1.50–1.69 −21.9%** (15/30).
  Free singles: 1.70–1.99 −13.5%, 2.00–2.49 −17.4%. Where the model sat 5+ points
  above a 45–64% market, priced singles lost 11–15%: **the market was right when
  they disagreed.** Chasing higher odds would cost subscribers money.
- **Higher confidence helps.** VIP 80–84: 87.0%, +4.4% (n=85); 85+: 87.0%, +7.0%
  (n=15); 75–79: 77.3%, −5.6% (n=326). All-singles 80–84 struck 84.9% against a
  79.1% market — the one band where the model shows information beyond the price
  (n=173 priced). Small sample; not a profitability claim.
- **Calibration** is good: stated 65–69 → 64.2%, 70–74 → 70.8%, 75–79 → 76.8%,
  80–84 → 84.9%, 85+ → 86.7%.
- **By market (VIP):** match winner 83.8% (−4.1%), double chance 78.9% (−4.6%),
  over/under 80.0% (−1.9%), draw no bet 87.5% (+3.1%, n=28), BTTS 71.4% (+2.6%, n=21).
  Only the first three have samples worth reading.
- **By league (VIP, n≥15):** best Conference League 95.5% (n=22), Europa League 84.0%;
  worst Champions League 62.5% (−32.0%, n=16) and Premier League 74.2%. Samples are
  small; no league rule was made from them.

## 4. Changes

| Change | Evidence | Status |
|---|---|---|
| **Market check on ordinary paid curation.** A VIP-route pick is admitted to VIP/PREMIUM only if a usable quote (pre-kickoff, <6h) does not put the market >10pp from the model. Unpriced picks stay eligible as before. | Dropped picks, out-of-sample: 14–7, ROI −11.1%, median 1.46; in-sample 4–2. Constant is the existing gate's, not fitted. | Shipped |
| **Thin-day widening for ordinary curation.** With <3 core fixtures on the day, a widened-scope pick at the tier floor may be admitted if the market confirms it at 75–87% (PREMIUM 80–87%), ≥5 books, within 10pp. | Added picks: 32 in-sample at 81.3%, 6 out-of-sample at 100%. Floors unchanged. | Shipped |
| **Admission only.** A pick already in a paid feed is never removed by a price move, before or after kickoff. | Protects the record and what subscribers have seen. | Shipped |
| **Dedicated pass: per-kickoff-day quota (8), soonest day first, 12-call daily spend cap.** | Midnight burst + 75 stand-downs on 13 Nov. Effect on yield **not measurable offline** (needs live model calls). | **Experimental** |
| **`PAID_ROUTE_PRIMARY_PROVIDER`** (env, off by default) leads paid-route generation with the named provider. | Floors were measured on Gemini; supply collapsed after the switch. Skill difference not shown. | Owner's decision |
| **Empty paid feed copy** explains why a day can be quiet. | 13 Nov, 6, 9, 11 Nov were 0–2 pick days. | Shipped |
| Audit + backtest scripts, and a `paid-performance` job in `diagnose-generation`. | — | Shipped |

Not changed, deliberately: confidence floors (the published promise is "every VIP
pick clears 75% confidence"), the 87% cap, the gate, the dedicated prompt, retries of
rejected fixtures (re-asking the same model until it says 75 would be fishing).

## 5. Before / after (replayed ordinary curation, 85 days to 12 Nov)

Both arms carry the dedicated picks that were actually published. Market check reads
the last pre-kickoff quote, which is slightly *better* informed than production will
be (reported, not hidden). In-sample < 15 Oct ≤ out-of-sample.

| VIP | n | Strike | ROI [90% bootstrap] | Brier | Mean picks/day | Active days <2 picks |
|---|---|---|---|---|---|---|
| Current rule | 237 | 82.1% | −2.9% [−8.1, 2.0] | 0.148 | 2.79 | 31 / 61 |
| Proposed rule | 248 | 84.2% | −2.0% [−6.6, 1.9] | 0.137 | 2.92 | 27 / 61 |
| — out-of-sample, current | 180 | 82.8% | −2.9% [−7.8, 3.2] | 0.144 | | |
| — out-of-sample, proposed | 165 | 85.5% | −0.9% [−6.7, 5.0] | 0.129 | | |

**The ROI difference is inside the noise; do not read it as improved profitability.**
Brier and strike improve in both halves. Supply rises slightly (+0.13 picks/day, 4
fewer sub-2-pick active days). PREMIUM is neutral (53 picks either way, ROI −2.1% →
−3.9% on two dropped winners at 1.83 — a sample of two).

The rule **cannot restore 4–8 VIP picks a day on its own.** Since 1 Nov the binding
constraint is confidence supply (§2.1): 9–11 Nov were widened days with no candidate
at 75%+ to widen to.

## 6. Settlement and records

- **Accuracy:** all 3,824 auto-settleable published singles were re-resolved from
  their stored final scores with `resolveMarket`; **0 disagree** with the stored
  outcome (5 half-time markets cannot be re-resolved from the full-time score).
- **Unresolved more than 6h after kickoff: 61**, all handed to manual settlement by
  the auto-settler: 27 no fixture returned by the provider, 13 penalty shoot-out
  score missing, 12 still not finished 72h after kickoff (postponed/abandoned), 4
  inconsistent score breakdown, 2 missing extra-time breakdown, 1 no fixture on the
  day. 7 of them are VIP picks. They need an admin's manual settlement; they are
  excluded from every figure above rather than guessed.
- **Duplicates:** 7 paid fixtures were carried twice in one feed, all on
  4–20 Sep, before the paid-tier cutover (3 Oct). None since.
- **Confidence vs certainty:** paid copy states confidence as a floor ("clears 75%
  confidence"), never as a promise; the new empty-feed text explains quiet days and
  makes no promise of picks. `check-certainty-language` passes.

## 7. Deployment

1. Merge after review; no schema change, no migration, no new secret.
2. Deploy as usual. Curation picks up the market check on the next settle run;
   the dedicated pass on its next poke. cron-job.org needs no change.
3. Watch for a week: `npm run verify:vip-premium` and the `paid-performance` job.
   `/admin/jobs` run summaries now carry `KICKOFF_DAY_QUOTA` skips. Curation reports
   `marketDisagreeExcluded` and `widenedAdmitted`.
4. Optional, owner's call: set `PAID_ROUTE_PRIMARY_PROVIDER=gemini` to test whether
   paid-route supply returns; compare a fortnight with the audit's section F.

## 8. Rollback

- Provider switch: unset `PAID_ROUTE_PRIMARY_PROVIDER` (no deploy needed beyond env reload).
- Everything else: revert the merge commit. Paid tags written meanwhile are ordinary
  `PredictionCategoryLink` rows; nothing to clean up. No data was modified by this work.

## 9. Risks and missing evidence

- **No closing-line archive.** ROI uses the last cached pre-kickoff quote; CLV exists
  only for dedicated picks. Storing a pre-kickoff snapshot per published pick would
  make CLV and true entry-price ROI measurable.
- **Claude-era sample is two weeks** (589 singles, 141 VIP-route). Whether its
  confidence should be re-scaled, or the floors re-measured for it, needs ~4–6 weeks.
- **Dedicated-pass quota change is experimental**: its yield effect needs live data.
- **Backtest is mildly optimistic** for the market check (near-close quote).
- **Sample sizes**: per-league and per-band figures under n≈50 are directional only.
- Concurrency: no open PRs at the time of writing; this branch touches curation,
  the paid pass, the provider chain and one copy string.
