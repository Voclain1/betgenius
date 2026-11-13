# Paid predictions sprint 02: calibration, value and profitability (13 Nov 2026)

Evidence: production, read-only, through `diagnose-generation` run #37 (job
`paid-performance`, step "Calibration fit…"; the session is verified
`transaction_read_only = on` first). Reproduce: `npm run fit:calibration`.

**Headline.** On 2,400 out-of-sample settled singles, no selection had a
credibly positive expected value at the median bookmaker price, and the model's
confidence added no reliable information beyond the market's own price. The
negative ROI is structural, not a tuning problem. Nothing in this sprint makes a
profitability claim, and live selection is unchanged. What it adds is the means
to *demonstrate* value if it ever appears: calibrated probabilities, EV at an
executable price, and a point-in-time record of every paid decision.

## 1. Production reconciliation

- #175 is merged (`ad75cb7`) and deployed (`deploy-vps` run 59, success, 14:26 UTC 13 Nov).
- No open PRs, so no overlap with the competitive-improvement programme.
- Primary provider chain unchanged: Claude Haiku, then Gemini, then Groq.
  `PAID_ROUTE_PRIMARY_PROVIDER` (from #175) is off unless set in production;
  its value there could not be read from this session.
- Prices: `Prediction.odds` is null; prices come from `FixtureOddsCache`, which
  keeps **one quote per fixture, overwritten until kickoff**. No historical price
  snapshots exist. This decides what can and cannot be validated (§6).

## 2. Verified root causes of the negative ROI

From the walk-forward predictions (validation 23 Sep – 5 Nov, held-out test 6–12 Nov).

1. **The bookmaker margin, against no demonstrated edge.** VIP's median price is
   1.19. At that price the median book carries ~4–6% margin. The de-vigged market
   forecasts better than the model (Brier 0.182 vs 0.195 on validation, 0.190 vs
   0.202 on test). A pick whose true chance is the market's loses about the
   margin, which is what the record shows (VIP −3.1%).
2. **Stated confidence barely tracks price.** It is compressed into ~65–78
   whatever the odds:

   | Median odds | n | Stated (raw) | Market | Realised |
   |---|---|---|---|---|
   | <1.20 | 610 | 76.0% | 84.0% | **85.7%** |
   | 1.20–1.34 | 564 | 73.2% | 73.9% | 78.2% |
   | 1.35–1.49 | 381 | 71.0% | 66.2% | 68.8% |
   | 1.50–1.69 | 284 | 69.3% | 59.3% | **55.6%** |
   | 1.70–1.99 | 131 | 66.6% | 52.0% | **42.0%** |
   | 2.00+ | 67 | 64.9% | 41.6% | **37.3%** |

   Short-priced picks are underconfident and long-priced ones grossly
   overconfident. Where model and market disagree, the market is right. Picks
   that look like "value" to the model are mostly its errors.
3. **Market mix.** Over/under (raw 72.5% vs realised 63.7%) and BTTS (66.2% vs
   58.0%) are the most overconfident markets and lose most (−12.5%, −9.1%).
4. **Provider scales differ.** Claude states 5–10 points *below* what it achieves
   (stated 66.9 → 74.0%, 71.7 → 76.5%, 76.8 → 83.3%; n=578). Gemini is
   calibrated at 70–80, and Groq is overconfident (77.2 → 66.7%). So the 75/80
   floors mean different things depending on which model wrote the pick.

## 3. Calibration findings

Calibrators, all fitted chronologically:

- **RAW** — stated confidence as is.
- **C1** — pooled Platt scaling.
- **C2** — Platt per provider.
- **C3** — hierarchical: provider fits shrunk toward the pooled fit (k=150), plus market intercepts (k=150).
- **C4** — isotonic per provider.
- **M0** — the market alone.
- **M1** — model and market combined.

| Brier (lower is better) | RAW | C1 | C2 | C3 | C4 | M0 market | M1 model+market |
|---|---|---|---|---|---|---|---|
| Validation, all rows (n=2017) | 0.197 | 0.196 | 0.196 | **0.193** | 0.196 | | |
| Validation, priced rows (n=1702) | 0.195 | | | 0.192 | | 0.182 | **0.181** |
| Test, all rows (n=396) | **0.195** | 0.200 | 0.197 | 0.200 | **0.195** | | |
| Test, priced rows (n=334) | 0.202 | | | 0.208 | | **0.190** | 0.195 |

Paired-bootstrap 90% intervals:

| Comparison | Validation | Test |
|---|---|---|
| C3 − RAW | −0.0037 [−0.0054, −0.0025] | +0.0047 [−0.0039, +0.0104] |
| M1 − M0 | −0.0011 [−0.0021, −0.0003] | +0.0055 [0.0000, +0.0141] |

- **Pre-registered rule → C3 NOT activated.** It improved validation but not the
  held-out week. That week is Claude-dominated and fell on an international
  break, and the fit had seen only ~1 week of Claude.
- **The model adds nothing reliable beyond the market.** The fitted blend puts
  weight 1.09 on the market and 0.18 on the model.
- Sample sizes: 3,814 decided rows — Gemini 3,005, Claude 578, Groq 223, legacy 8.
  Per-market and per-odds-band cells are reported where n≥30. Competition-level
  calibration was not fitted: most league cells are under 100 rows.

The fitted artifact `cal-20261113-1` is committed **inactive**
(`src/lib/calibrationArtifact.ts`), with its evidence inside it. Raw confidence
is never overwritten anywhere.

## 4. Market-level profitability (near-close median prices)

| Market | n | Strike | Median odds | ROI [90%] | Mean model EV | Credible +EV (lower bound ≥ 0) |
|---|---|---|---|---|---|---|
| Match winner | 173 | 78.6% | 1.25 | +0.9% [−5.9, +9.2] | −5.1% | 0 |
| Double chance | 1215 | 75.6% | 1.27 | −3.7% [−8.5, −2.1] | −5.1% | 2 |
| Over/under | 491 | 65.2% | 1.34 | −12.5% [−16.6, −5.5] | −10.4% | 0 |
| BTTS | 158 | 57.0% | 1.54 | −9.1% [−20.2, 0.0] | −16.4% | 0 |
| Draw no bet | 68 | — | — | **cannot be valued**: 61 derived prices, no executable quote | | |
| Team total, win either half, correct score | 48 | — | — | **cannot be valued**: no market in the feed | | |

- Higher win probability is not higher profitability. Double chance wins 75.6%
  and loses money; match winner wins 78.6% at similar prices and is the only
  market not clearly negative, but its interval includes zero.
- **Correction to #175's report:** its draw no bet "+3.1%" used a price derived
  from the 1X2, not a quote a subscriber can take. Disregard it.
- Void handling: draw no bet EV is computed as P(win)·odds + P(draw) − 1, with
  P(draw) from the de-vigged 1X2 (`expectedReturn`). It is never used, because
  no executable price exists.

## 5. Before / after (strategy replay, same daily population)

| VIP strategy | Validation n (/day) | Validation ROI [90%] | Test n | Test ROI [90%] |
|---|---|---|---|---|
| P175 production | 218 (4.36) | +0.2% [−5.6, +5.7] | 18 | −15.0% [−34.9, +3.9] |
| V0 P175 ∩ EV ≥ 0 | 5 (0.10) | +19.2% (n=5) | 1 | −100% (n=1) |
| V1 P175 ∩ EV lower bound ≥ 0 | **0** | — | **0** | — |
| V2 ranked by EV, EV ≥ −3% | 77 (1.54) | +7.9% [+0.4, +14.6] | 6 | −21.7% |
| CF calibrated floor (C3 ≥ 0.75) | 234 (4.68) | +2.1% [−2.7, +6.8] | 28 | −11.7% |
| U1 any single, EV lower bound ≥ 0 | **0** | — | **0** | — |

Also measured:
- Odds deterioration of 3% or 5% subtracts 3–5pp from every arm.
- Requiring 8+ books shrinks samples below readability.
- Brier, ECE, max drawdown and losing runs are in the run log.

**Pre-registered rule → no value strategy recommended:** none has an ROI
interval wholly above zero in both periods. V2's validation result does not
survive the held-out week.

## 6. What could not be validated, and how it now can

Every price-based number above uses the **last pre-kickoff quote**. That is later
information than a pick had when it was selected, which is leakage for selection
and makes value strategies look better than they would live. Model-only
calibration (C1–C4) uses no price and is leakage-free. A valid point-in-time
test needs prices captured at decision time, so this sprint adds that capture:

- **Shadow log (default on).** Every paid curation run writes a
  `paid-selection-shadow` JobRun. For every candidate at the tier floor it
  records:
  - provider and market;
  - raw confidence, calibrated probability and its lower bound;
  - median price, books and quote age;
  - break-even, EV and lower-bound EV;
  - the #175 verdict, the value verdict and every rejection reason;
  - whether it was selected.

  It also records the mode, calibration version and a dry-day summary.
- **Dedicated picks** now freeze, inside `marketConfirmation` at promotion:
  provider, model, calibration version and active flag, entry median price and
  books, and the full value assessment — the true entry price.

After 4–6 weeks of shadow data, re-run the fit with point-in-time prices.

## 7. Changes

| Change | Status |
|---|---|
| `src/lib/calibration.ts`: Brier, log loss, ECE, logistic with covariance, isotonic (PAV, min block, shrinkage), hierarchical fit, versioned artifact, delta-method SE | Library |
| `src/lib/paidValue.ts`: EV with win/void/loss, break-even, lower bound (z=1.28, SE floor 0.02), rejection reasons, diversified ranking, decision combiner, dry-day summary | Library |
| `cal-20261113-1` artifact | Committed, **inactive** |
| `PAID_SELECTION_MODE` = `current` / `shadow` (default) / `value` | Shadow is live; value needs an active artifact or falls back |
| Value mode: #175 rule AND EV lower bound ≥ `PAID_VALUE_MIN_EV_LOWER` (default 0); ranked by lower-bound EV; no market over half the admitted picks; outage fallback `NO_PRICING` | **Experimental, inert** |
| Shadow log of every paid curation decision | **Live** (one JobRun per VIP/PREMIUM curation run, ~16/day) |
| Point-in-time value record on dedicated picks | **Live** (extra keys in `marketConfirmation`; the badge ignores them) |
| **Security: locked predictions API now an allowlist** | **Live** — see §8 |
| `scripts/fit-calibration.ts`, `check-calibration-value.ts` (59), `check-paid-value-integration.ts` (51) | Tooling |

Unchanged: confidence floors (75/80, the published promise), the gate, the
prompt, the provider chain, entitlements, payments, the UI.

## 8. Paid-tier security fix

`/api/predictions` blanked four fields on locked rows and spread the rest. For a
reader without access, VIP and Premium rows still carried:
- `selection`, `market`, `marketType`;
- the goal line;
- `analysisJson`, `marketConfirmation` (whose `value` names the selection);
- earlier drafts.

In effect that is the pick. Locked rows now go through `lockedPredictionView`,
an allowlist of fixture fields, so any future column is withheld by default.
Nothing in the app calls this endpoint, so no page changes. It is unknown
whether anyone used it.

## 9. Database and deployment

- No schema change, no migration, no new secret; shadow data uses the existing `JobRun` table.
- Deploy as usual. To keep behaviour byte-identical to #175 (no shadow writes),
  set `PAID_SELECTION_MODE=current`.
- To monitor, filter `/admin/jobs` (or `JobRun`) on `paid-selection-shadow`.
  Each summary line reads: candidates at floor / priced / pass #175 / show value
  / both / feed size.
- Generation cost (last 30 days, dedicated pass): 192 model calls, 2.39M tokens,
  78 published picks, so **2.5 calls per published pick**. The admin generation
  panel's spend-by-pass table (#149) remains the cost monitor.

## 10. Rollback

- `PAID_SELECTION_MODE=current` stops all assessment and shadow writes immediately.
- `PAID_CALIBRATION_DISABLED=1` removes the artifact everywhere.
- Full rollback: revert the merge commit. Shadow JobRun rows are inert and can stay.

## 11. Remaining uncertainties and next steps

- **No point-in-time prices before today.** Every EV and ROI figure is near-close.
- The held-out week is 7 days, Claude-heavy, during an international break. The
  calibration verdict could change with more data. Refit monthly with
  `npm run fit:calibration`; commit a new version only through the script's rule.
- Claude's underconfidence (5–10 points) looks real (n=578) but is two weeks
  old. If it persists, the 75/80 floors are filtering out picks Claude rates 70
  that win ~76%. A calibrated floor (CF) is the principled fix. It changes what
  "75%" means on the page, so it is the owner's decision once a calibration
  passes its held-out test.
- Over/under and BTTS are the weakest paid markets on every measure. Their
  removal from VIP was not tested, because samples inside VIP are small (O/U
  n=69 validation, −6.1%). It is a candidate for the next evaluation.
- 61 picks still await manual settlement (from #175's audit).
