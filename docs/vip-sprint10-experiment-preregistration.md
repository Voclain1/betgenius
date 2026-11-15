# Sprint 10 pre-registration: alternative-market (goals) shadow experiment

This document was committed **before any model call**. The binding definitions are code in `src/lib/altMarketResearch.ts`, spec `alt-market-s10-v1`. This page restates them; where the two differ, the code wins. The criteria will not be tuned after results are seen.

## Question

Do covered professional fixtures that favourite-based targeting never examines yield picks that **independently clear the existing VIP/PREMIUM gate** when the dedicated pass is pointed at them because of a goals price?

## What is held fixed

These match production exactly:

- **Prompt:** `buildPredictionRequest` with the pass's own inputs.
  - Categories `["FEATURED"]`, intent `VIP_PREMIUM`, so market breadth is `multi` and `paidRoute` is on.
  - `lowerRisk` with the same avoid-list (`existingPicksOnFixture`).
  - Calibration from `resolveGenerationRisk`.
- **Provider and model:** the production primary, Anthropic `claude-haiku-5-5` (or `ANTHROPIC_MODEL` if production sets it), effort `high`.
- **Gate:**
  - `evaluateMarketConfirmed`, which requires model ≥ 75, market 75–87%, gap ≤ 10pp, ≥ 5 books and a quote less than 2h old.
  - `paidTierFor`, which requires PREMIUM model ≥ 80 **and** market ≥ 80.
  - `repeatsExistingPick` refusal, with one pick per fixture chosen by `compareMarketConfirmed`.
- **Pre-persist rejection:** the certainty-language and house-voice scans are applied exactly as generation does. A violation means production would have discarded every draft.

## Differences from production, all for safety

- **One HTTP request per evaluation:** no SDK retry (`maxRetries: 0`) and no fallback provider. If the primary fails, the evaluation is recorded as an `ERROR`.
- **Cache-only context:** stale caches are read as they stand, and that is recorded in `context.stale`. No refresh, so no api-football calls and no writes.
- **Nothing is persisted or published.** Observations go to the workflow log and to `research/alt-market/observations/*.json`, which are committed afterwards.

## Eligibility, first failing rule in order

1. Covered: ledger SUCCEEDED, with an ordinary row on the fixture.
2. Paid scope: CORE = `PAID_CORE_LEAGUE_IDS`, SECONDARY = `PAID_WIDENED_LEAGUE_IDS`.
3. Not already attempted by the dedicated pass, with no dedicated pick on the fixture, and not evaluated in an earlier run.
4. Kickoff 12–24h away, and the cached quote is at most 2h old.
5. **Not favourite-targeted:** no Match Winner or Double Chance side at 75%+. This uses the corrected Double Chance labels, so away favourites count as Path A's.
6. Over 1.5 or Over 2.5 priced at 75–86.96% by ≥ 5 books.

Under 2.5, Under 3.5 and BTTS are **recorded for comparison only**. They never select a fixture.

## Sampling

- Dry days come first. A dry day is a Lagos kickoff day that, at sampling time, carries ≤ 2 published VIP/PREMIUM fixtures.
- Then the order is ascending `sha256("alt-market-s10-v1:" + fixtureApiId)`.
- At most 20 CORE and 10 SECONDARY across all runs.
- Fixtures are upcoming at sampling time. No fixture whose result is known is ever sampled.
- If fewer are eligible, the sample is smaller. Nothing is backfilled.

## Hard ceilings, across all invocations

| Item | Ceiling | How it is enforced |
|---|---|---|
| Evaluations | 30 | Checked before each call, from committed observations |
| Model requests | 30 | One per evaluation, no retry |
| api-football requests | 40 | Expected 0: no client is imported, and context and odds are cache-only |
| Cost | $0.30 | At $0.10 / $0.50 per MTok. Before each call, the input is counted (free `countTokens`) and the call is refused if `input + 16,000 output` tokens could breach the ceiling |
| Stop | 3 consecutive provider errors | Also stops when the credential or model cannot be verified (free `models.retrieve`) before any billed call |

## Evaluation

**After the run:**

- The qualification rate (VIP-or-better), with a Wilson 95% interval, for CORE and SECONDARY separately.
- PREMIUM count.
- Incremental fixtures: qualifying fixtures with no existing VIP/PREMIUM pick.
- Dry-day gains.
- Markets and confidence.
- Cost.

**After settlement** (outcomes come from the stored final score of settled production rows on the same fixture):

- Strike rate with a Wilson 95% interval.
- Stated versus realised probability.
- ROI at the recorded entry price, which is the median pre-kickoff price of the exact selection.

These stay **pending** until the fixtures settle.

## Decision rule, for further research only

| Outcome | Condition |
|---|---|
| GO, larger prospective shadow | ≥ 5 incremental qualifying fixtures **and** a qualification Wilson lower bound ≥ 10% |
| NO-GO | ≤ 1 incremental qualifying fixture |
| INCONCLUSIVE | Anything else |

Activating Path B is out of scope whatever the result. Thirty fixtures cannot establish quality.
