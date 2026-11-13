# Sprint 05: league coverage, candidate discovery and VIP/Premium selection quality (13 Nov 2026)

All production evidence below is read-only. It comes from `diagnose-generation`
runs 40 and 41 (job `league-coverage`), on a database session that the script
checks is `transaction_read_only = on`. The provider probe spent 13
api-football calls (the script caps it at 40). Nothing was written to
production, and no flag, cron or migration was changed.

Reproduce:

- `npm run measure:league-coverage`
- `npx tsx --env-file=.env scripts/research-league-coverage.ts`
- `npm run validate:paid-candidate-quality`

## 1. Where fixtures are lost (45 days, 4,318 discovery runs)

| # | Loss point | Code | Evidence |
|---|---|---|---|
| 1 | **Not in the catalogue.** The gate refuses the fixture as `unrecognised_competition` | `fallbackQualityGate`, `generationTierOf` | Cymru North and Cymru South (provider id 111, "FAW Championship") are absent. 1,028 of 1,273 provider fixtures today and tomorrow are in 217 uncatalogued competitions, mostly youth, reserve and regional leagues |
| 2 | **Tier gating.** DEEP_FALLBACK is scanned only when CORE+SECONDARY has fewer than 12 fixtures in the next 48h | `decideCoverage` | The mode was DEEP_FALLBACK in 551 of 4,318 runs, on 10 of 46 days. Wales is DEEP_FALLBACK |
| 3 | **Fill order.** FALLBACK fills the target first, and DEEP_FALLBACK gets only what is left | `fillFromTiers` | 975 widened runs had their sweep skipped because the target was already met. 388 fallback fixtures were queued: 361 FALLBACK, 27 DEEP_FALLBACK |
| 4 | **Priority ordering inside a tier.** A low-ranked league is queued only after every fixture of every higher-ranked one | `planFallback` | Structural, by construction. Wales sits near the end of DEEP_FALLBACK |
| 5 | **Stale capability.** The Welsh Cup is configured with no odds, so it is refused as `unpriced_cup` | `cupConfig` (id 112) | The provider reports `odds=true`, and 1 of 2 sampled ties had 5 bookmakers. 45 `unpriced_cup` rejections in the window |
| 6 | **Lead time.** The sweep finds the fixture already inside 12h of kickoff | gate `inside_lead_time` | 2,313 rejections, the largest single cause. The sweep runs hourly at most |
| 7 | **Sweep lease or quota** | `acquireSweepLease`, `SWEEP_MIN_QUOTA_REMAINING` | 311 runs were held by the hourly lease; 28 had too little quota |
| 8 | **Paid scope.** No FALLBACK or DEEP_FALLBACK league can enter VIP or Premium | `PAID_ANY_LEAGUE_IDS` | 0 VIP and 0 Premium picks from those tiers, by design |

Two suspected causes were ruled out:

- **Queue starvation.** No ledger row reached kickoff unattempted.
- **Worker truncation.** Since there is no starvation, the queue's priority sort was left unchanged.

## 2. Wales

| Competition | Provider id / season | Provider says | Ours | Sampled books |
|---|---|---|---|---|
| Cymru Premier | 110 / 2026 (31 Jul – 26 Mar) | odds, standings | catalogued, DEEP_FALLBACK | 0 and 0 (fixtures a week out) |
| Welsh Cup | 112 / 2026 (16 Oct – 14 Nov) | odds | DEEP_FALLBACK, **wrongly marked unpriced** | 5 and 0 |
| Cymru North / South | **111** "FAW Championship" / 2026, rounds "North - n" / "South - n" | odds, standings | **not catalogued** | 8 and 8 |
| Welsh League Cup | 738 / 2025 (ended 28 Feb) | no odds | not catalogued | none: stale season, excluded |

**Why did BetGenius ignore the Welsh fixtures?** Discovery never queued a
single Welsh fixture in 45 days: 0 ledger rows. The 26 Welsh predictions that
exist came from lanes that bypass discovery: Banker generation
(`BANKER_GENERATED`, Cymru Premier, 6 Nov) and `STANDARD_CURATED` (Welsh Cup,
13 Nov). They are three separate causes:

1. Wales is DEEP_FALLBACK, and fills last even on the days that mode is reached.
2. The Welsh Cup's capability record says it has no prices.
3. Cymru North and South are missing from the catalogue.

`/admin/paid-ops` now answers this question per competition, from the data.

## 3. Changes

### Competition eligibility registry

File: `src/lib/generation/competitionEligibility.ts`.

- Each entry stores the provider evidence it rests on: source, check date,
  season dates, coverage flags, sampled bookmaker counts and the finished-score
  sample. None of it is taken from memory.
- The current entries:
  - add 111 as DEEP_FALLBACK;
  - mark the Welsh Cup as priced;
  - keep 110 as it is;
  - exclude 738.
- No entry widens the paid scope.

### Fair discovery (proposed rules)

- Competitions take turns inside a tier (round-robin by kickoff, with priority as the tie-break).
- No more than 4 fixtures per competition per sweep.
- The tier order is unchanged: FALLBACK still fills before DEEP_FALLBACK, because the tiers themselves were set from evidence.

### Rollout control: `COVERAGE_ROLLOUT`

| Value | Behaviour |
|---|---|
| `off` | Exactly as before |
| `shadow` (default) | Discovery acts on the current rules. It records, in the discovery JobRun (`coverage.sweep.shadow`), what the proposed rules would have queued from the same payload, with no extra provider calls. Per-competition gate rejections are now recorded too (`gateRejectedByLeague`) |
| `on` | Discovery acts on the proposed rules. Registry additions are excluded from generation whenever their tier is out of scope |

### Candidate-quality layer, shadow only

File: `src/lib/paidCandidateQuality.ts`.

- Every candidate gets one decision, plus all the reasons it failed:
  - `QUALIFIED`, `SHADOW_ONLY`;
  - `REJECTED_DUPLICATE`, `TOO_CLOSE_TO_KICKOFF`, `INSUFFICIENT_DATA`, `MISSING_PRICE`, `STALE_DATA`, `INVALID_PRICE`, `LOW_CONFIDENCE`, `LOW_VALUE_EVIDENCE`, `CORRELATED_SELECTION`.
- The inputs are kept separate:
  - model probability;
  - market probability;
  - uncertainty, which is the calibrated lower bound, or "uncalibrated";
  - expected value, only when calibrated;
  - quote age, books and lead time.
- League reputation is not an input.
- It is recorded in the existing `paid-selection-shadow` log as `quality` (versioned `quality-s05-v1`). Curation never reads it back.

**Proposed VIP / Premium hierarchy.** Premium is stricter evidence, not just a
higher number.

| Bar | VIP | Premium |
|---|---|---|
| Confidence | ≥75 | ≥80 |
| Market probability | 75–87% | 80–87% |
| Model/market gap | ≤10pp | ≤6pp |
| Bookmakers | ≥5 | ≥8 |
| Value evidence | not required | lower-bound EV ≥0 from an **active** calibration |

With no active calibration, a Premium candidate is `SHADOW_ONLY`, never
qualified.

### Diagnostics in `/admin/paid-ops`

- What it shows:
  - discovery modes, sweeps and skips;
  - shadow comparisons;
  - quality decisions over the last 24h;
  - the funnel per competition (discovered, generated, failed, priced, published, VIP, Premium, gate rejections);
  - "Why were Welsh fixtures not covered?".
- Every query is bounded (`take` limits, a 14-day window).
- Access is admin-only through the existing admin layout.

### Unrelated fix

- `check-vip-premium-overlay` was failing on master: its stub predates Sprint 04's `publishPaidPredictionAtomically`.
- The stub and its source assertions now follow the atomic path.
- This is a test-only change.

## 4. Policy validation (settled history, chronological, bars fixed beforehand)

**Data.** 1,691 settled published singles at confidence ≥75 over 120 days:

- 1,301 have a closing price (the last pre-kickoff quote);
- 390 are unpriced;
- 0 have a recorded entry price;
- 39 post-kickoff quotes were discarded.

**Holdout.** It starts 18 Oct (VIP, 120 days). Fixtures that share a kickoff
time never straddle the split.

| VIP, 120d | n | Win (95% Wilson) | ROI at closing | Holdout win | Holdout ROI |
|---|---|---|---|---|---|
| Existing | 514 | 79.6% (75.9–82.9) | −3.8% | 83.1% | −2.3% |
| Quality-first | 427 | 81.0% (77.0–84.5) | −6.0% | 80.6% | −6.8% |
| Diversified | 325 | 83.1% (78.6–86.8) | −4.5% | 81.5% | −6.3% |
| Expanded coverage | 564 | 80.7% (77.2–83.7) | −6.5% | 80.3% | −7.0% |
| Strict Premium | 29 | 86.2% (69.4–94.5) | n<30 | 4/6 | n<30 |

The same ordering holds in the 60-day and 30-day windows.

For Premium over 60 days, existing scores 87.2% and +3.7% ROI (n=78), while
quality-first scores 80.7% and −8.3% (n=57).

**Findings**

- **Quality-first filtering does not improve out-of-sample results.** It
  removes the higher-priced picks (mean odds 1.16 against 1.26) without raising
  the win rate. It stays shadow-only, and activating it is **not** recommended.
- **Strict Premium:** 29 picks in 120 days and 6 in the holdout. The sample is
  too small to judge either way.
- **Diversification** lowers concentration (the largest league share falls from
  10% to 6%), with no measurable return effect.
- **Expanded coverage:** picks outside the paid scope that clear the VIP bars:
  - DEEP_FALLBACK: n=37, 89.2% (75–96), +1.9%;
  - FALLBACK: n=75, 76.0%, −11.5%.

  This is no basis for widening the paid scope. The DEEP_FALLBACK sample is too small.
- **Missing-odds sensitivity:** 113 existing VIP picks have no price. If all of
  them had lost, ROI would be −24.2% instead of −3.8%. Existing ROI is therefore
  less certain than quality-first's, which uses only priced picks.
- **Caveats:**
  - closing prices are later than publication, so they are optimistic about price availability;
  - near-kickoff quotes are judged as if taken an hour before kickoff, which is lenient;
  - no entry-priced sample exists yet.

## 5. API-Football impact

| Item | Calls |
|---|---|
| Shadow mode (default) | **0 additional.** The comparison reuses the sweep payload |
| `COVERAGE_ROLLOUT=on` | 0 additional for discovery: the same 2–3 `/fixtures?date=` calls per sweep, still at most hourly. Fixtures that become eligible cost the normal generation calls each (about 5–10 per fixture, cache-dependent). The cap of 4 per competition per sweep and the unchanged fallback target (~25–28 fixtures) bound this. No volume increase on healthy days, because the sweep does not run then |
| Diagnostics | Database only |
| Provider probe | ≤40 calls per manual run (13 used) |

## 6. Tests and CI

| Check | Result |
|---|---|
| `check-league-coverage-quality` (new) | 82/82 |
| Areas covered | Welsh discovery, season mapping, supported vs unsupported, missing standings, partial stats, thin books, freshness, fair batching, tier-ordered scheduling, duplicates, postponed/finished, near kickoff, missing/invalid/derived odds, uncalibrated confidence, contradictions, correlation, tier qualification, holdout leakage, missing historical prices, shadow isolation, no unintended activation, diagnostics, design rules |
| Existing suites | All pass: `check-goals-generation` (stale caller assertion repaired, failing on master), `check-adaptive-coverage` (assertion updated for 111), `check-european-clubs`, `check-generation`, `check-vip-premium-overlay` (228, repaired), `check-paid-selection`, `check-paid-value-integration`, `check-paid-market-quality`, `check-paid-subscriber`, `check-paid-render`, subscription/Paystack/one-time entitlement |
| `tsc --noEmit` | clean |
| New workflow `league-coverage-quality.yml` | Runs all of the above on PRs |
| Sprint 04 `paid-market-quality.yml` | Also runs here, because `vipPremiumPipeline.ts` and the admin page changed. That includes the disposable-Postgres atomic publication test |

## 7. Deployment and rollback

**Deploy**

- No schema change and no migration.
- Shipping in the default shadow mode changes no live behaviour. It adds
  `gateRejectedByLeague` and `shadow` to the discovery JobRun detail, and
  `quality` to the shadow log.

**Activation (needs owner approval)**

- After about 2 weeks of shadow sweeps on thin days, review
  "lifted rejections" and "competitions the proposed rules would add" in
  `/admin/paid-ops`.
- Then set `COVERAGE_ROLLOUT=on`.

**Rollback**

- Set `COVERAGE_ROLLOUT=off`, or revert the squash commit.
- Fixtures already queued under `on` are excluded again once their tier is out
  of scope. Nothing else needs cleaning up.

## 8. Implemented vs awaiting activation

| Item | Status |
|---|---|
| Audit tooling, provider probe, diagnostics, per-competition rejections, quality shadow log, validation | Live on merge (record only) |
| Registry (111, Welsh Cup odds) and fair ordering with the cap | Awaiting `COVERAGE_ROLLOUT=on` |
| Quality-first VIP / Premium policy | Shadow only. The evidence does **not** support activation |
| Cymru Premier tier promotion | Not proposed: no bookmaker evidence |

**Not done, and why**

- Uncatalogued competitions other than Wales were not added. Most are youth,
  reserve or regional, and each needs its own provider evidence.
- Paid-scope widening was not proposed, for lack of evidence.
