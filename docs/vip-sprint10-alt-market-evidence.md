# Sprint 10 evidence: alternative markets and dry-day paid supply

Status on 14 Nov 2026: qualification results are in for the first prospective run. **Outcomes are pending** until the evaluated fixture finishes (15 Nov, 19:45 UTC) and a settle job is requested. Nothing here was published, and no production setting, quota or route was changed.

Companion documents:

- `docs/vip-sprint10-experiment-preregistration.md`: the pre-registered spec, committed in 5660862 before any model call.
- `src/lib/altMarketResearch.ts`: the binding definitions, spec `alt-market-s10-v1`.

## 1. Market capability map

| Layer | Markets it can handle | Notes |
|---|---|---|
| Bookmaker feed (cached api-football odds) | Match Winner, Double Chance, Goals Over/Under (several lines), Both Teams Score, Handicap and others | Double Chance away side is labelled **`Draw/Away`** in 1,512 of 1,531 cached quotes |
| Generation (`MARKET_TYPES`) | Match Winner, Double Chance, Over/Under, BTTS, Draw No Bet and others | The dedicated pass already asks for `multi` market breadth |
| Gate (`MC_ELIGIBLE_MARKET_TYPES`) | MATCH_WINNER, DOUBLE_CHANCE, OVER_UNDER, BTTS, DRAW_NO_BET | A goals pick is already judged on its merits once drafted |
| Targeting (`TARGETABLE_SELECTIONS`) | Match Winner Home/Away, Double Chance Home/Draw, Away/Draw | Goals are **intentionally** absent: this list only decides which fixtures get a paid-tier attempt |

**Confirmed defect.** The fixture can't reach the dedicated pass through an away Double Chance. Targeting asks for `Away/Draw`, but the feed writes `Draw/Away`, and the coverage lookup matched labels exactly, so it returned nothing. The effect over 30 days:

- 0 of 212 dedicated targets were away Double Chance.
- 77 CORE and 82 SECONDARY covered fixtures had an away Double Chance at 75%+ and were never targeted.

The fix (`sameSides` in `src/lib/marketConfirmed.ts`) matches the two sides in either order.

**This is the only change in the PR that alters production behaviour once merged.** After merge:

- Away-favourite fixtures become eligible for the dedicated pass, within its existing 8/day quota and 12/day spend cap.
- Away Double Chance drafts can pass the gate's coverage check.

No floor, band, book minimum or quota is changed.

## 2. Read-only baseline (30 days, `measure-alt-market-baseline.ts`)

| | CORE | SECONDARY |
|---|---|---|
| Covered fixtures | 421 | 750 |
| Not favourite-targeted (corrected DC labels) | 189 | 442 |
| Of those, Over 1.5 or Over 2.5 at 75–86.96% | 98 (97 Over 1.5) | 152 (all Over 1.5) |
| Existing VIP/PREMIUM on those fixtures | 12 | 0 |
| Ordinary goals picks, all confidences | 67 | not split |
| Ordinary goals picks at 75+, settled | 6 of 10 won | 18 of 23 won |

Dry days carried few goals-band fixtures, so goals-band discovery is not, on this evidence, a dry-day remedy by itself.

The ordinary-pick strike rates come from a different route, prompt and selection. They describe the market, not what the dedicated pass would produce.

## 3. Experiment design

The full design is in the pre-registration. In short:

- Prospective only.
- Fixtures 12–24h out, with a quote at most 2h old and at least 5 books.
- Not favourite-targeted.
- Over 1.5 or Over 2.5 priced at 75–86.96%.
- Production prompt, model and gate.
- One request per evaluation, with no retry or fallback.
- Cache-only football data.
- Nothing persisted.

Hard cumulative ceilings:

- 30 evaluations.
- 30 model requests.
- 40 api-football requests.
- $0.30.

The run starts only from a deliberate trigger: a dispatch, or a committed `research/alt-market/run-request.json` with the confirmation token.

## 4. Observations

Run 1 is GitHub run 43655061794, on 14 Nov 2026 at 23:50 UTC. It is recorded in `research/alt-market/observations/run-2026-11-14T23-50-01-566Z.json`.

Before any billed call, the run checked:

- The credential and model, through a free `models.retrieve`.
- That the database session was read-only.

Screening found 14 covered paid-scope fixtures 12–24h out.

| Result | Fixtures |
|---|---|
| Eligible | 1 |
| Already attempted by the dedicated pass | 5 |
| No fresh quote | 4 |
| No goals price in band | 3 |
| Favourite-targeted | 1 |

**Evaluation:**

- **Fixture:** Belgium v Italy, UEFA Nations League (SECONDARY), kickoff 15 Nov 19:45 UTC.
- **Day context:** not a dry day, with 4 paid fixtures already on it.
- **Goals signal:** Over 1.5 at 79.3% from 6 books.
- **Favourite signal:** 68.2%.

| Draft | Model | Gate | Market | Gap | Books | Tier | Entry price |
|---|---|---|---|---|---|---|---|
| Over 1.5 Goals | 80 | CONFIRMED | 79.3% | 0.7pp | 6 | **VIP** | 1.18 |
| Belgium or Draw | 57 | MODEL_BELOW_FLOOR | – | – | – | – | 1.38 |

- **Outcome:** VIP. This is incremental, because the fixture has no existing VIP/PREMIUM pick. It is not PREMIUM, because PREMIUM needs a market of 80+.
- **Certainty and house-voice scans:** clean.
- **Context:** every source came from cache, with no stale reads.
- **Cost:** 9,730 input and 4,021 output tokens, which comes to **$0.0030**, plus 0 api-football requests.

**Cumulative ledger:**

- 1 of 30 evaluations.
- 1 of 30 model requests.
- 0 of 40 api-football requests.
- $0.003 of $0.30.
- 0 of 20 CORE and 1 of 10 SECONDARY.

The run summary's `ledgerAfter` prints `secondaryUsed: 0`. That figure is cosmetic. Allocation is recomputed from the groups in committed observations at the start of each run (`run-alt-market-experiment.ts:91-92`), so the next run counts this fixture.

## 5. Qualification results

| | Evaluated | VIP-or-better | PREMIUM | Incremental | On a dry day |
|---|---|---|---|---|---|
| CORE | 0 | – | – | – | – |
| SECONDARY | 1 | 1 | 0 | 1 | 0 |

**Qualification is 1 of 1, with a Wilson 95% interval of 21–100%.** This is a single fixture. It shows the route is mechanically sound: the pass drafted a goals pick, the existing gate confirmed it and the tier was assigned correctly. It says nothing about rate or quality.

## 6. Settlement methodology and pending outcomes

`scripts/settle-alt-market-experiment.ts` is read-only.

- It keeps only observations recorded before kickoff.
- It takes the final score stored on settled production rows for the same fixture.
- It resolves each pick with `resolveMarket`.
- It leaves a fixture PENDING when there is no settled sibling row or the stored scores conflict.

It reports:

- Strike rate with a Wilson interval.
- Stated versus market probability.
- ROI at the recorded entry price.

| Fixture | Pick | Status |
|---|---|---|
| Belgium v Italy, 15 Nov | Over 1.5 @ 1.18 | **PENDING** |

To settle, commit `run-request.json` with `"job": "settle"` after the match has finished and production has settled it.

## 7. Architecture options, for evaluation only

Neither path is activated here.

**Path A: favourite-based targeting, as it is today, plus the Double Chance fix.**

- No new route. It reuses the existing dedup, freshness, gate, entitlements, quotas and settlement.
- The fix restores a candidate class that was intended and was lost by accident (159 fixtures over 30 days).
- Risk: more paid attempts compete for the same 8/day quota. The cap still bounds spend and volume.

**Path B: goals-band discovery as a second targeting signal.**

- Add Over 1.5/2.5 at 75–86.96% to the targeting list, or run a separate goals screen. Either way the result feeds the same pass.
- It could share everything downstream (the dedupe key, the 2h freshness rule, `evaluateMarketConfirmed`, `paidTierFor`, `repeatsExistingPick`, entitlements, quota, settlement), because the gate already handles OVER_UNDER.
- Open questions:
  - How Path B fixtures should rank against favourite fixtures for the 8 slots.
  - Whether a slate dominated by low-priced Over 1.5 picks (around 1.18) is acceptable to the product.
  - Real strike rate and stated-versus-realised calibration, which needs far more than 30 fixtures.

## 8. GO / NO-GO

| Decision | Recommendation |
|---|---|
| Merge the Double Chance label fix (Path A defect) | **GO, after your review.** It is a confirmed defect with production evidence, it changes no thresholds and it is bounded by the existing quota and spend cap. |
| Activate Path B in production | **NO-GO.** It is out of scope, and one fixture is no evidence of quality. |
| Pre-registered research decision | **NO-GO, interim.** `researchDecision` returns NO_GO for ≤ 1 incremental qualifying fixture, and there is 1. The GO bar is ≥ 5 incremental with a Wilson lower bound ≥ 10%. The sample is 1 of a designed 30 and is still open, so this is not a final verdict. |
| Further capped runs (cumulative ≤ 30, prospective, never backfilled) | Optional. Each run needs an explicit committed request. |

