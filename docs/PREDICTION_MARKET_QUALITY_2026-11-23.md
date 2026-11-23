# Prediction market quality: investigation and remediation (23 Nov 2026)

**Status:** review-ready PR, not merged or deployed. Every behaviour change that alters what is generated or shown is behind a flag that **defaults off**. Published predictions are never modified.

## 0. Evidence basis

| Source | Used | Notes |
|---|---|---|
| Code and call graph | Yes | Every root cause below is confirmed in code. |
| **Production database, read-only** | **Yes** | Read through `.github/workflows/market-quality-audit.yml`, built the same way as the existing `diagnose-generation` workflow: the session is `default_transaction_read_only=on` and the scripts refuse to start otherwise. The repository is public, so the logs contain aggregates only. |
| Production audit | 30 days | 2,802 generated rows; 2,350 settled published singles. Separate 7- and 14-day views. |
| Chronological backtest | 45 days | Blend weight fitted on the earlier 60% (1,752 picks, 9 Oct–5 Nov) and judged on the later 40% (1,168 picks, 5–22 Nov). |
| Counterfactual selection | 880 fixtures | Jobs where the model wrote at least two markets, graded against final scores with the pure settlement function `resolveMarket`. |
| Prior studies | Yes | `docs/PAID_VALUE_CALIBRATION_2026-11-13.md` (2,400 out-of-sample singles) and `docs/MARKET_ODDS_FLOOR_AND_COVERAGE_RESEARCH_2026-11-20.md`. |

**Price caveat (applies to every return figure).** Prices are the last cached quote before kickoff (near-close), not necessarily the price at the moment of generation. Return figures are at the median price across bookmakers, not the best. 90% intervals are bootstrap intervals.

**Reproduce:**
- `npm run audit:market-quality -- 30`
- `npm run backtest:market-selection -- 45`

Both need a read-only `DATABASE_URL`, or a run of the workflow.

## 1. What production shows (30 days to 23 Nov)

### Generation and publication

- **Generated markets, ordinary route (1,839 rows):**

  | Market | Share |
  |---|---|
  | Double Chance | 47.6% |
  | Over/Under | 22.8% |
  | BTTS | 13.9% |
  | Team Total | 5.9% |
  | Draw No Bet | 5.2% |
  | **Match Winner** | **4.5%** |

  The VIP route (685 rows) is 44.7% Double Chance.
- **Published FEATURED (1,607 rows):** 57.2% Double Chance.
- **Every publication was admin-approved:** 2,522 rows, none automatic, often bulk-approved at the same second. Admin review does not filter market quality; generation decides it.
- **Homepage, rebuilt with the live ranking:** 5–6 of the 6 slots were Double Chance on 24, 25, 26 and 28 Nov.

### Calibration and returns on settled published singles

| Market | n | Strike | Stated confidence | Brier, model | Brier, market | Return at median (90%) |
|---|---|---|---|---|---|---|
| Double Chance | 1,111 | 74.3% | 70.4 | 0.188 | 0.178 | −3.5% (−6.5, 0.0) |
| Over/Under | 638 | 63.2% | 66.4 | 0.225 | 0.209 | −9.2% (−12.4, −2.8) |
| BTTS | 274 | 54.7% | 62.0 | 0.259 | 0.248 | −10.7% (−17.0, −0.5) |
| Match Winner | 125 | 80.0% | 77.4 | 0.167 | 0.168 | −1.9% (−10.9, +7.0) |
| Draw No Bet | 72 | 88.9% | 70.8 | — | — | unpriced |
| Team Total | 128 | 82.0% | 72.6 | — | — | unpriced |

- **Stated confidence against the de-vigged market** (mean gap): Double Chance −3.2 points, BTTS +5.2, Over/Under +0.9, Match Winner +1.1. **Confidence is not comparable across markets.**
- **Price coverage, published:**
  - verified price (3+ books): 81.3%;
  - Draw No Bet and Team Total: 0% priced;
  - Double Chance: median 1.25, with 33.8% under 1.20.
- **Secondary "Over/Under" column:** "Over 2.5 Goals" on 2,138 of 3,550 published rows. Settled strike 56.5%, against the market's own 56.3%: no independent signal.
- **Integrity:**
  - 369 of 1,706 FEATURED fixtures (21.6%) carried more than one published single;
  - 293 published picks were priced below 1.12 in 45 days (some predate the floor; admin-requested generation is exempt);
  - Draw No Bet: of 108 published with a derivable price, 40 (37%) had a fair price below 1.12 and 72 (67%) below 1.20 (median fair price 1.16).
- **API-Football use:** 6,421–7,125 requests a day. This change adds none.

### The named homepage examples

| Fixture | What was published | What the market said | Why it was shown |
|---|---|---|---|
| RB Leipzig v Lens (UCL, 24 Nov) | One early job published **two** rows: Leipzig or Draw at 72% (median 1.13, fair 84%) and Over 2.5 at 64% (1.30, fair 72%) | Leipzig win 1.44 (fair 66%), never considered | The early guidance invited a second pick and every draft was persisted. Evidence was incomplete (`contextComplete=false`). Admin bulk approval. |
| Feyenoord v Porto (UCL, 24 Nov) | Porto or Draw at 70% (1.44, fair 65%) plus Over 2.5 at 60% (1.60, fair 59%), again **two** rows | Balanced (2.70 / 3.70 / 2.40) | Double Chance is defensible on a balanced fixture; the duplicate row is not. |
| Ajax v FC Thun (UECL, 26 Nov) | Ajax or Draw at 72%, **median 1.04** (fair 92%) | Ajax win 1.17 (fair 79%) | Admin-requested generation is exempt from the 1.12 floor. The model's 72% sat 20 points under the market. |
| Brighton v Universitatea Craiova (UECL, 26 Nov) | Brighton Draw No Bet at 72%, unpriced | Derived fair Draw No Bet price **1.07** | Draw No Bet has no cached quote, so it passed every price check. |

The secondary column read "Over 2.5 Goals" for all four. **TEAM_TOTAL vs match total:** none of these examples was a Team Total. The "Over 2.5" shown beside each was the secondary match-total outlook (`ouLine`/`ouDirection`), not a team-goals market.

## 2. Root causes (confirmed or rejected)

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| 1 | One primary market per fixture prevents comparison | **Confirmed** | Single breadth; alternatives are never assessed against price. |
| 2 | Cautious instructions favour Double Chance | **Confirmed, and wider than thought** | `resolveGenerationRisk` prompts every routine free fixture as GENIUS (top leagues and European competitions as VIP). The prompt treats **both** as "cautious", with the rule "on a boundary choose the more hedged band", so the "standard tier, no hedging preference" branch never runs for routine generation. |
| 3 | Confidence-first ranking amplifies it | **Confirmed** | Homepage and Genius both sort by stated confidence, which is structurally higher for hedges and not comparable across markets. Unpriced Team Total and Draw No Bet took 23.8% of homepage slots. |
| 4 | Some markets lack cached odds | **Confirmed** | Draw No Bet, Team Total and Win Either Half are never priced. Draw No Bet bypassed the floor. |
| 5 | The 1.12 floor is insufficient | **Partly rejected** | Returns by price band are not stable across halves: 1.12–1.20 was +0.8% then −8.8%; 1.20–1.30 was −6.2% then −0.7%. There is no measured basis for a higher floor on return grounds. The real gap was the **bypasses**: Draw No Bet, and admin-requested generation. |
| 6 | Confidence is not calibrated consistently across markets | **Confirmed** | Double Chance stated low, BTTS and Over/Under stated high. The market beats stated confidence on held-out data (Brier 0.195 vs 0.207). |
| 7 | The secondary Over/Under looks like a second tip | **Confirmed** | Same visual weight as the Pick, and "Total goals: …" in the match verdict. It strikes at the market's own rate. |
| 8 | Early and normal candidates are not reconsidered | **Partly** | Holds and admin review exist. But the early lane persisted every draft, causing duplicates. |
| 9 | Curation discards or obscures stronger alternatives | **Confirmed in part** | Alternatives were never kept, and curation compares incomparable numbers. |
| 10 | Checks validate picks but not selection usefulness | **Confirmed** | Nothing checked whether a price existed, or how near-worthless it was, for unpriced markets. |

**The decisive finding, which reframes the brief.** Replacing Double Chance by price or expected value does **not** produce better decisions on this data. Old = the model's first draft; paired return is new minus old, at the median price:

| Selection rule (880 real multi-market fixtures) | Double Chance share | Strike | Return | Paired return (90%) |
|---|---|---|---|---|
| Current: model's first draft | 68.6% | 74.5% | −6.9% | — |
| Maximise blended EV | 37.5% | 65.2% | −8.5% | −0.8% (−2.9, +2.1) |
| "Repair": replace short or unpriced primaries | 47.4% | 66.8% | −9.5% | −2.2% (−4.2, +1.7) |
| "Guard": replace only failed primaries | 57.0% | 69.4% | −8.9% | −1.4% (−3.3, +0.7) |

- **Returns are all near minus the bookmaker margin.** No rule beats the model's own primary on realised return.
- **Fewer Double Chance labels do not mean better decisions.** All three rules reduce Double Chance while lowering strike rate.
- **Generation-time switching therefore ships in shadow only.** It records decisions at generation-time prices so that it can be judged prospectively. It is not enabled.

## 3. Research summary

**Approach chosen:**
- **Calibrated probabilities judged with proper scoring rules:** Brier score and log loss (Brier 1950; Gneiting & Raftery 2007, *JASA*). The repository's `src/lib/calibration.ts` already implements Brier, log loss, ECE, Platt and isotonic fits.
- **Overround removal by proportional normalisation** within each complete outcome set (`devigProbability`).
  - The literature compares this with Shin's method and finds the differences small at typical football margins (Štrumbelj 2014, *International Journal of Forecasting*).
  - Double Chance and Draw No Bet are derived from the de-vigged 1X2, not from their own quotes, to avoid double margin.
- **Bookmaker consensus as a strong baseline forecaster.** The bookmaker consensus is hard to beat; models add value mainly where they decorrelate from it (Hubáček, Šourek & Železný 2019, *IJF*). Selecting for calibration rather than accuracy matters for betting decisions (Walsh & Joshi 2024, *Machine Learning with Applications*). Our held-out result is consistent with both: the market alone was the best probability; stated confidence added nothing measurable.
- **Chronological (walk-forward) evaluation only:** fit on earlier kickoffs, judge on later ones. Never random splits.
- **Expected value at the executable median price, used only as a diagnostic.** With calibrated probabilities near the market, EV is about minus the margin, so EV ranking mostly selects the lowest-margin market rather than the best football call. Rejected as a selection objective (§2).

**Alternatives rejected:**
- **A higher fixed floor (1.20 or 1.25):** not supported by stable evidence (§2 #5).
- **Forced market diversity quotas:** explicitly excluded by the brief, and would lower strike rate with no return benefit.
- **Activating the inactive calibration artifact** (`cal-20261113-1`): it failed its held-out week.
- **New data providers:** out of scope.
- **Extra model calls per fixture:** cost, with no demonstrated benefit.

**API-Football:**
- **Odds already loaded:** the `/odds` endpoint is already fetched and cached in `FixtureOddsCache` (trimmed to Match Winner, Double Chance, Goals Over/Under, BTTS and Handicap Result), and generation already loads it before calling the model.
- **No more requests needed:** everything here uses those cached odds; no new requests and no new markets are added.
- **Not yet available:** exact Team Total and Draw No Bet quotes would need the cache trimming extended. That is a separate, measured change (see `MARKET_ODDS_FLOOR_AND_COVERAGE_RESEARCH_2026-11-20.md`).

## 4. What this PR changes

### Unconditional, and evidence-backed

1. **One canonical row per fixture** for single-market generation.
   - Extra drafts stay in the job record (`src/lib/ai/generate.ts`).
   - This fixes duplicates such as Leipzig and Porto (21.6% of FEATURED fixtures). Paid impact: only 5 of 259 VIP/Premium rows in 45 days came from such extra rows.
2. **Draw No Bet floor.** A Draw No Bet whose fair price derived from de-vigged 1X2 is below 1.12 fails the existing automatic floor, because its executable price can only be lower (`src/lib/autoOddsFloor.ts`). Brighton's 1.07 would have been rejected; 37% of published Draw No Bet picks were in this state.
3. **Goals outlook presentation:**
   - The table column reads **Goals outlook** in muted text.
   - It shows nothing when the pick is itself a match-goals call.
   - The match verdict reads "Goals outlook: over 2.5 goals." instead of "Total goals: …", so it no longer reads as a second backed selection.
   - No layout or design change.

### Flagged; all default off

| Flag | Effect | Recommendation |
|---|---|---|
| `MARKET_SELECTION_MODE` (`off` / `shadow` / `on`) | **shadow:** the same model call also returns up to 3 independently reasoned alternatives (no extra request). `selectPrimary` records the decision (`AIJob.rawOutput.marketSelection`), and the row gets a fixed `analysisJson.selectionQuality` snapshot. **Publication is unchanged.** **on:** a primary that failed price verification is replaced by the model's likeliest verified alternative, with its own confidence and reasoning; an early pick with no verified selection is held for review. Admin-requested generation is never switched. | **shadow now**; review 2–4 weeks of decisions at generation-time prices before considering `on`. |
| `MARKET_QUALITY_RANKING` (`off` / `on`) | Homepage Featured/Genius excerpts and Genius curation rank **verified-price picks first**, then the existing order. The tier comes from the generation-time record; legacy rows are inferred from the market type. Stable and outcome-blind. | **on** after review: the only change with a measured improvement (§5). |
| `FREE_TIER_NEUTRAL_BANDS` (`off` / `on`) | Free-tier prompt without the cautious "more hedged band" rule. VIP and Premium keep their caution. | Trial it with the monitoring page. Its effect cannot be measured offline. |

### Selection policy (`src/lib/marketSelection.ts`)

**Each candidate is evaluated on:**
- the exact quote, its median, bookmaker count and quote age (provider timestamp; 96 hours maximum);
- the de-vigged fair probability, with Double Chance and Draw No Bet derived from 1X2;
- a blended probability: 0.3 × stated confidence + 0.7 × market. Held-out Brier: market alone 0.195, blend 0.196, stated confidence 0.207.

**Tiers:**

| Tier | Meaning |
|---|---|
| QUALIFIED | median ≥ 1.20, 3+ books, blended ≥ 50%, stated confidence no more than 15 points above the market |
| SHORT | the same, at 1.12–1.20 |
| UNPRICED | no executable price, too few books, or a stale quote |
| INELIGIBLE | below the floor (including derived Draw No Bet), blended below 50%, or more than 15 points above the market |

**Decision rules:**
- The **guard** objective keeps any verified primary (QUALIFIED or SHORT).
- It switches only from a failed primary, to the likeliest verified alternative.
- Otherwise it holds, and it always holds when evidence is incomplete.
- It never picks the highest confidence or the highest odds, and never raises a confidence.

### Monitoring (`/admin/market-quality`, `src/lib/marketQualityReport.ts`)

**Reported over 7, 14 or 30 days:**
- market mix by category and by generation route;
- verified-price share, unpriced share, median price and short share;
- picks below the floor from automatic generation, and duplicate fixtures;
- Double Chance concentration;
- selection decisions and hold reasons;
- 30-day calibration by market;
- API requests per day;
- VIP/Premium availability.

**Alerts,** anchored to the measured baseline above:

| Alert | Fires when | Baseline |
|---|---|---|
| Verified price | below 75% | 81.3% |
| Unpriced | above 15% | 8.8% |
| Duplicate fixtures | above 5% | 21.6% before the fix |
| Below-floor automatic picks | above 0 | — |
| Double Chance in FEATURED (info) | above 65% | 57.2% |
| Calibration gap | above 10 points (n ≥ 100) | worst 7.3 |
| Holds | above 30% | — |
| API requests | above 7,150 a day | — |
| VIP/Premium | below 60% of the 30-day rate | — |

The production audit and backtest remain runnable on demand through the read-only workflow.

## 5. Before vs after

**Homepage FEATURED, 45 days, 269 slots, same days and pools:**

| Ranking | Strike | Return at median (90%) | Unpriced slots | Short slots | Median price | Double Chance |
|---|---|---|---|---|---|---|
| Current: confidence first | 79.1% | −6.6% (−12.9, −1.6) | 23.8% | 21.6% | 1.17 | 57.6% |
| **Verified first (`MARKET_QUALITY_RANKING=on`)** | **77.7%** | **−3.0% (−8.0, +2.7)** | **0.4%** | 39.8% | 1.22 | 72.9% |
| Verified first, short also demoted (rejected) | 72.0% | −4.6% (−10.5, +0.3) | 0.4% | 2.2% | 1.30 | 69.5% |

- **Verified-first is the chosen ranking.** Per-day return improved by +5.5 points (90% interval −1.1 to +12.9): directionally better, not conclusive at 90%.
- **It raises the Double Chance share on the homepage.** That's because it removes unpriced Team Total and Draw No Bet picks, not because it prefers Double Chance. The brief's success criterion is defensible, verified, appropriately priced picks, not a label mix, and the data does not support forcing Double Chance down.

**Integrity:**
- **Duplicate published singles per FEATURED fixture:** 21.6% before; after, prevented at generation by one row per fixture.
- **Draw No Bet picks with a derived fair price below 1.12:** 37% before; after, rejected by the floor.

**Prompt and alternatives:** not measurable offline. Shadow mode and the monitoring page exist to measure them prospectively.

## 6. Safety

**API-Football quota:**
- No new requests.
- Selection reuses the odds generation already loads.
- Monitoring, audit and backtest read only the database.
- Recent baseline: 6,421–7,125 requests a day; the quota rules from #229 and #233 are untouched.

**Model cost (shadow and on only):**
- About 250 more prompt tokens per call (~3% of the 8,900 median).
- 200–350 more output tokens (~4–7% of the 4,900 median).
- About 35 ordinary and early calls a day.
- No extra calls.

**VIP and Premium:**
- The paid pass, European lane, Banker, combos and Goals are excluded from selection.
- VIP-route prompts keep their caution.
- Tier floors (75/80) and paid curation rules are unchanged.
- One row per fixture removed 5 of 259 paid rows in 45 days. The monitoring page alerts if paid output falls below 60% of its 30-day rate.

**Published predictions:**
- Nothing in this PR updates, deletes, unpublishes or rewrites a published row.
- Ranking reads a record fixed at generation.
- `on` mode only changes a draft before it is first persisted.
- Asserted in `scripts/check-market-selection.ts`.

**Public copy:** no "AI" wording, no banners, and no SEO or URL changes.

## 7. Limitations

1. **Near-close prices.** Return figures use near-close cached prices; shadow mode records generation-time prices for the real test.
2. **Counterfactual coverage.** It covers only jobs where the model wrote two or more markets (combo, paid and some ordinary jobs). Single-market jobs had no alternatives to compare.
3. **The prompt change is unmeasured** offline.
4. **Team Total, Draw No Bet and Win Either Half** cannot be price-verified until the odds cache retains their exact quotes.
5. **No market-selection rule shows positive returns.** All markets settle near minus the bookmaker margin. The remediation improves honesty, verification and presentation; it does not claim profitability.
6. **Admin-requested generation stays exempt** from the floor, as the owner decided. It is visible in monitoring.

## 8. Rollout and verification

1. **Merge and deploy.** No schema change and no migration. The unconditional changes take effect: one row per fixture, the Draw No Bet floor, and the goals outlook.
2. **Set `MARKET_SELECTION_MODE=shadow`.** Watch `/admin/market-quality` for 2–4 weeks: hold reasons, decisions, the cost line and the paid alert.
3. **Set `MARKET_QUALITY_RANKING=on` when ready.** Then check that the homepage shows verified-price picks and stays stable through the day.
4. **Optionally trial `FREE_TIER_NEUTRAL_BANDS=on`.** Compare the market mix and calibration on the monitoring page.
5. **Re-run the read-only audit monthly** with the workflow, and decide on `MARKET_SELECTION_MODE=on` only with prospective evidence.
