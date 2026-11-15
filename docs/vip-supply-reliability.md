# VIP/Premium supply reliability: where qualifying supply is lost

Evidence date: 15 Nov 2026, 09:10 UTC.

The source is read-only audit runs 43697030068 and 43697810970 (`sprint11-production-audit.yml`), which ran these scripts against production:
- `scripts/measure-supply-funnel.ts`: 14 days, unique fixtures.
- `scripts/measure-attempt-yield.ts`: 30 days, as recorded at the time.

Nothing was deployed, no flag was changed, and no model or api-football request was made.

**Verdict:**
- **No verified, avoidable defect is losing qualifying supply.**
- The shortfall comes, in order, from:
  1. genuine scarcity (an international break with no core fixtures);
  2. intentional scope and market rules;
  3. a deliberate per-day attempt quota that binds on rich European nights.
- One evidence gap blocks the last unexplained class. This PR closes it with a behaviour-neutral record.
- **No supply improvement is claimed.**

## 1. The funnel, 1–14 Nov (unique fixtures, Lagos kickoff day)

| Stage | Count | Notes |
|---|---|---|
| Fixtures discovered | 530 | |
| Covered (ordinary generation) | 520 | All but 10 |
| In paid scope | 204 | Core, or widened when the pass widened in the fixture's window |
| With a 5-book pre-kickoff quote | 202 | Odds availability is not the bottleneck |
| Lopsided (MW/DC ≥ 75 at close) | 115 | Closing reference: the last pre-kickoff quote |
| Attempted by the dedicated pass | 85 | One model request each |
| Draft ≥ 75 | 55 | |
| Promoted (gate passed) | 35 | |
| Published | **35 of 35** | Publication is not losing supply |
| VIP fixtures, all routes | **41** | 35 dedicated, 6 ordinary |
| PREMIUM fixtures | **20** | A strict subset of VIP |

**Days:**
- 7 of 14 days had at most 2 VIP picks.
- 4 days had none: 6, 9, 10 and 11 Nov.
- From 9 to 14 Nov there were **0 covered core fixtures**. That was an international break, and the only paid-scope supply was widened national-team and minor-league fixtures.

**API use.** api-football calls ran at 6,668–7,403 a day against the 7,500 ceiling, with odds taking 316–1,477 of them. The dedicated pass made 119 odds calls over 1,534 runs and reached its 12-call warm limit only once.

**VIP versus PREMIUM.** Both use the same gate. PREMIUM additionally needs model ≥ 80 and market ≥ 80. Every PREMIUM pick is also VIP, so PREMIUM supply is bounded by VIP supply.

## 2. First loss per covered paid-scope fixture (`supplyFirstLoss`, tested)

| First loss | Fixtures | Class |
|---|---|---|
| WIDENED_NOT_IN_SCOPE | 180 | **Intentional.** Widened competitions are excluded on healthy days. Sprint 08 tested admitting them and measured about −10% at closing reference. |
| MARKET_NOT_LOPSIDED | 80 | **Scarcity.** No side at 75%+. |
| VIP | 41 | – |
| MODEL_BELOW_FLOOR | 29 | **Genuine.** Every draft was under 75. |
| **QUOTA_SPENT** | **20** | **Allocation cap.** Lopsided, never attempted, and the kickoff day's quota was spent. |
| GATE_REJECTED | 18 | **Genuine.** A draft ≥ 75 failed the gap, band, books or tier check. |
| **NOT_ATTEMPTED_LOPSIDED** | **12** | **Unexplained.** Lopsided at close with quota left. |
| ORDINARY_RULE_REJECTED | 2 | Intentional (#175) |
| NO_ODDS_IN_SCOPE | 2 | Angola v South Sudan and Algeria v Togo: no 5-book quote |

## 3. Hypotheses tested and refuted

**H1: attempts are wasted on favourites too short to sell, above 86.96%.**

The pass targets any headline ≥ 75 with no upper cap. The gate refuses prices above 86.96%. Yield measured over 30 days and 215 attributable attempts:

| Signal band | Attempts | Promoted (VIP/PREM) | Yield |
|---|---|---|---|
| 75–78 | 43 | 9 (3/6) | 21% |
| 78–82 | 53 | 15 (10/5) | 28% |
| 82–86.96 | 57 | 32 (26/6) | 56% |
| **Above 86.96** | **62** | **20 (10/10)** | **32%** |

Above the ceiling, the model often drafts a different, sellable market. Excluding those fixtures would cost about 20 promotions a month. **Refuted. No change.**

**H2: fixtures are attempted twice, consuming quota.**

In 30 days, 206 attempt records cover 204 fixtures, so 2 are extras. The 13 target runs with no gate verdict break down as:
- 7 soft-deadline deferrals, with no attempt made;
- 4 failures on the old Gemini route;
- 2 certainty-language rejections.

**Refuted.**

**H3: missing or stale odds starve the pass.**
- 202 of 204 in-scope fixtures had a 5-book quote.
- The warm budget was hit once in 1,534 runs.

**Refuted** as a material cause.

**H4: publication failures.** 35 of 35 promotions were published. **Refuted.**

## 4. The two candidate-recoverable classes

**QUOTA_SPENT (20 fixtures)**

- 13 fell on 5 and 7 Nov under the old creation-day quota, which #175 replaced on 13 Nov. 7 fell on 12–14 Nov, mostly widened national-team fixtures.
- On 5 Nov, 17 attempts were made on that day's kickoffs. The current kickoff-day rule (8 per day) would have allowed only 8. **On rich European nights the present quota is more binding than the old one.**

**This is a deliberate cost and volume cap, not a defect.**

**Simulated estimate, not observed.** Multiply each of the 20 by the yield of its signal band:

| Band | Fixtures | Yield | Expected promotions |
|---|---|---|---|
| 75–78 | 4 | 21% | 0.8 |
| 78–82 | 5 | 28% | 1.4 |
| 82–86.96 | 5 | 56% | 2.8 |
| Above 86.96 | 6 | 32% | 1.9 |

That gives **about 7 more promotions in 14 days**, against 35 observed. It is an upper bound: the pass attempts the strongest market first, so the marginal fixtures are weaker than average.

The cost would be about 20 more model requests, roughly $0.08, plus context fetches, most of which are cached.

Raising the quota is an owner decision about cost and volume. It is **not implemented**, because no qualification standard is wrong.

**NOT_ATTEMPTED_LOPSIDED (12 fixtures)**

Examples include Villarreal v PSG (closing 78.2), Fenerbahçe v Liverpool (83.5) and RB Leipzig v Man City (82.5), all 3–8 Nov.

Each was covered 37–46h before kickoff and had quota left. No quota stand-down was recorded in its 12–24h band, and its closing quote was taken 0.2–1.2h before kickoff.

The pass records only **counts** of skip reasons per run, not which fixture was skipped or why. So it cannot be established whether these fixtures:
- reached 75% only near kickoff (genuine);
- lacked a fresh quote during their warm band;
- lost the one-target-per-run ordering to stronger candidates.

Sprint 09 hit the same wall with 23 such fixtures. **This is the missing evidence.**

## 5. Correction in this PR (instrumentation only, behaviour-neutral)

`qualifyVipPremiumTargets` now also returns `warmBandSkips`. Each entry is one warm-band candidate (kickoff within 24h) that the run skipped, with:
- the reason (`NO_FRESH_QUOTE`, `NO_QUOTED_MARKET`, `MARKET_BELOW_BAR`, `KICKOFF_DAY_QUOTA`);
- the signal, when a quote was read;
- the quote's age.

Records are kept soonest kickoff first, at most 20 per run. `selectVipPremiumTargets` passes them into the run report, which the route already stores in `JobRun.detail`.

| Property | Status |
|---|---|
| Decision logic | Unchanged. No decision reads the field, which a test enforces. All 241 overlay, 64 spare-quota and the paid-selection, generation and European-lane checks pass. |
| API and model calls | None added. It reads values already in memory. |
| Floors, EV, gate, quota, scope, publication, access | Untouched |
| Storage | About 3 KB per run at most, roughly 0.3 MB a day at 96 runs |

**Not verified:**
- No settled result can come from this change. Its effect is evidence, and it starts once deployed.

## 6. Verification plan (after owner-approved deploy)

1. After 7 days, re-run `measure-supply-funnel.ts` and classify each NOT_ATTEMPTED_LOPSIDED fixture from its `warmBandSkips`:
   - MARKET_BELOW_BAR inside the band means genuine scarcity;
   - NO_FRESH_QUOTE means a warming gap, which is recoverable at no API cost by reordering warm candidates;
   - repeated top-ranked-elsewhere means an ordering effect.
2. Implement a supply correction **only** if one class is shown to lose qualifying candidates. Then compare promotions per day against this baseline:
   - 35 promotions in 14 days;
   - 41 VIP / 20 PREMIUM fixtures;
   - 7 days with at most 2 VIP.
3. For the quota, an owner decision is needed. If it's raised, measure observed promotions per extra attempt against the 21–56% band yields above.

## 7. Report items

1. **Qualified VIP candidates before and after:** 35 promotions and 41 VIP fixtures in 14 days. No "after" exists, because no supply change was made.
2. **Qualified PREMIUM candidates before and after:** 20 fixtures. Unchanged.
3. **Dry-day frequency:** 7 of 14 days at ≤ 2 VIP, 4 at 0. Unchanged. Most fell in the international break.
4. **API requests before and after:** unchanged. 0 added.
5. **Confidence and EV gate integrity:** unchanged. No threshold was touched, and tests pin it.
6. **Publication correctness:** 35 of 35 published, 0 after kickoff, 0 duplicate paid fixtures.
7. **Remaining unavoidable shortfall:**
   - the international break;
   - non-lopsided calendars (80);
   - model and gate refusals (47);
   - intentional widened-scope exclusion (180).

## Reproduce

```
dispatch sprint11-production-audit   # includes both scripts, read-only, no model key
npx tsx scripts/check-supply-funnel.ts
npm run check:vip-premium-overlay
```
