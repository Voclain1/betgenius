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

---

# Sprint 05 continuation: global coverage and evidence-based selection (13 Nov 2026)

Evidence for this part comes from `diagnose-generation` runs 42–45 (job
`league-coverage`). The database was read-only throughout. The global probe
spent 83 api-football calls in run 45, under its hard cap of 150; earlier
probe runs spent 90 each.

## A. Global competition audit

**The audit set**

- 217 uncatalogued competitions had a fixture on 13 or 14 Nov (UTC). This is the same definition that produced the earlier figure of 217.
- The provider lists 1,244 competitions with a current season.

**Evidence collected per competition**

- Identity, season and coverage flags (one `/leagues?current=true` call).
- Fixtures in the next 3 days and the previous 7 days (10 by-date calls).
- Score completeness of the finished fixtures.
- A bookmaker sample for every competition the rules left undecided: 72 of 72.
- BetGenius's own predictions for the competition over the last 60 days (read-only): **0** for every included competition.
- The share of fixtures played by women's sides, and the share played by reserve, B or youth sides. Both use the provider's team names; the second uses the same rule the generation gate applies.

**Rules** (`src/lib/generation/globalCompetitionAudit.ts`)

Region and reputation are never inputs.

| Decision | Criteria |
|---|---|
| **EXCLUDE** | Structural: youth, reserve or B, a friendly, no current season, season ended, no provider odds coverage, under 90% score completeness, or a regional/amateur level with no market |
| **WATCH** | Senior and current, but a data criterion is short: fewer than 5 sampled books, too few recent results, no standings for a league, a women's competition (needs the senior-women's lane), or a regional level |
| **INCLUDE** | Every criterion met |

Two classification corrections were made during the audit. Neither changes a
threshold.

1. Run 44 counted "Liga MX Femenil" and "USL Super League" as senior, because
   their names carry no women's marker. Women's detection now also uses the
   team names.
2. "Diski Challenge" passed on its name. In run 45 it showed 100% reserve
   sides, so it is now excluded with the other competitions made mostly of
   reserve or B sides.

The stored evidence is in `src/lib/generation/globalCompetitionEvidence.ts`.
Decisions are recomputed from it on load, and they match the probe's own
output on all 217 rows (tested).

| Region | INCLUDE | WATCH | EXCLUDE |
|---|---|---|---|
| Europe | 18 | 25 | 100 |
| Africa | 3 | 5 | 7 |
| Asia | 2 | 3 | 4 |
| North America | 3 | 4 | 3 |
| South America | 1 | 8 | 15 |
| Oceania | 2 | 1 | 0 |
| International | 2 | 1 | 8 |
| Other | 0 | 1 | 1 |
| **Total** | **31** | **51** | **135** |

| Exclusion reason | Competitions |
|---|---|
| Regional/amateur level with no market | 66 |
| No provider odds coverage | 51 (overlaps with the other reasons) |
| Reserve or B | 12 |
| Youth | 14 |
| Season ended | 9 |
| Friendly | 1 |

The 31 included competitions had **196 fixtures in the next 3 days**, and
BetGenius had evaluated none of them.

### INCLUDE

| Id | Competition | Country | Region | Upcoming (3d) | Finished (7d) | Books sampled | Reasons |
|---|---|---|---|---|---|---|---|
| 276 | FKF Premier League | Kenya | Africa | 9 | 9 | 6 | MEETS_ALL_CRITERIA |
| 201 | Botola 2 | Morocco | Africa | 8 | 8 | 6 | MEETS_ALL_CRITERIA |
| 828 | Ligue 2 | Tunisia | Africa | 14 | 13 | 5 | MEETS_ALL_CRITERIA |
| 100 | J3 League | Japan | Asia | 10 | 10 | 10 | MEETS_ALL_CRITERIA |
| 369 | Super League | Uzbekistan | Asia | 1 | 7 | 9 | MEETS_ALL_CRITERIA |
| 173 | Second League | Bulgaria | Europe | 9 | 9 | 7 | MEETS_ALL_CRITERIA |
| 122 | 2. Division | Denmark | Europe | 3 | 6 | 9 | MEETS_ALL_CRITERIA |
| 862 | 3. Division | Denmark | Europe | 5 | 6 | 8 | MEETS_ALL_CRITERIA |
| 494 | Super League 2 | Greece | Europe | 5 | 8 | 8 | MEETS_ALL_CRITERIA |
| 138 | Serie C - Girone A | Italy | Europe | 9 | 10 | 9 | MEETS_ALL_CRITERIA |
| 942 | Serie C - Girone B | Italy | Europe | 7 | 10 | 9 | MEETS_ALL_CRITERIA |
| 943 | Serie C - Girone C | Italy | Europe | 8 | 10 | 9 | MEETS_ALL_CRITERIA |
| 356 | Second League | Montenegro | Europe | 5 | 5 | 5 | MEETS_ALL_CRITERIA |
| 109 | II Liga - East | Poland | Europe | 6 | 8 | 9 | MEETS_ALL_CRITERIA |
| 236 | First League | Russia | Europe | 5 | 9 | 5 | MEETS_ALL_CRITERIA |
| 183 | League One | Scotland | Europe | 5 | 5 | 10 | MEETS_ALL_CRITERIA |
| 184 | League Two | Scotland | Europe | 5 | 5 | 10 | MEETS_ALL_CRITERIA |
| 287 | Prva Liga | Serbia | Europe | 5 | 8 | 5 | MEETS_ALL_CRITERIA |
| 506 | 2. liga | Slovakia | Europe | 7 | 8 | 8 | MEETS_ALL_CRITERIA |
| 374 | 2. SNL | Slovenia | Europe | 5 | 8 | 5 | MEETS_ALL_CRITERIA |
| 794 | 3. SNL - East | Slovenia | Europe | 7 | 8 | 5 | MEETS_ALL_CRITERIA |
| 205 | 2. Lig | Turkey | Europe | 17 | 17 | 8 | MEETS_ALL_CRITERIA |
| 111 | FAW Championship | Wales | Europe | 2 | 16 | 8 | MEETS_ALL_CRITERIA |
| 536 | CONCACAF Nations League | World | International | 8 | 5 | 10 | MEETS_ALL_CRITERIA |
| 28 | SAFF Championship | World | International | 2 | 4 | 6 | MEETS_ALL_CRITERIA |
| 163 | Liga de Ascenso | Costa-Rica | North America | 3 | 4 | 7 | MEETS_ALL_CRITERIA |
| 722 | Liga Premier Serie A | Mexico | North America | 9 | 10 | 5 | MEETS_ALL_CRITERIA |
| 263 | Liga de Expansión MX | Mexico | North America | 2 | 7 | 8 | MEETS_ALL_CRITERIA |
| 1202 | Australian Championship | Australia | Oceania | 5 | 8 | 9 | MEETS_ALL_CRITERIA |
| 955 | National League - National | New-Zealand | Oceania | 5 | 5 | 8 | MEETS_ALL_CRITERIA |
| 711 | Segunda División | Chile | South America | 5 | 6 | 6 | MEETS_ALL_CRITERIA |

### WATCH

| Id | Competition | Country | Region | Upcoming (3d) | Finished (7d) | Books sampled | Reasons |
|---|---|---|---|---|---|---|---|
| 411 | Elite One | Cameroon | Africa | 7 | 6 | 3 | THIN_BOOKMAKER_MARKET |
| 887 | Second League | Egypt | Africa | 0 | 5 | — | NO_UPCOMING_FIXTURES, BOOKMAKERS_NOT_SAMPLED |
| 1196 | Division One League | Ghana | Africa | 22 | 24 | 0 | THIN_BOOKMAKER_MARKET |
| 760 | LFA First Division | Liberia | Africa | 0 | 12 | — | NO_UPCOMING_FIXTURES, BOOKMAKERS_NOT_SAMPLED |
| 598 | Première Division | Mali | Africa | 4 | 7 | 0 | THIN_BOOKMAKER_MARKET |
| 764 | Premier League | Mongolia | Asia | 0 | 6 | — | NO_UPCOMING_FIXTURES, BOOKMAKERS_NOT_SAMPLED |
| 1197 | FA Cup | Oman | Asia | 0 | 3 | — | NO_UPCOMING_FIXTURES, TOO_FEW_RECENT_RESULTS, BOOKMAKERS_NOT_SAMPLED |
| 309 | Division 2 | Saudi-Arabia | Asia | 9 | 15 | 0 | THIN_BOOKMAKER_MARKET |
| 484 | Frauenliga | Austria | Europe | 4 | 0 | 0 | WOMENS_NEEDS_SENIOR_WOMENS_LANE, TOO_FEW_RECENT_RESULTS, THIN_BOOKMAKER_MARKET |
| 117 | 1. Division | Belarus | Europe | 9 | 9 | 1 | THIN_BOOKMAKER_MARKET |
| 316 | 1st League - FBiH | Bosnia | Europe | 8 | 8 | 2 | THIN_BOOKMAKER_MARKET |
| 317 | 1st League - RS | Bosnia | Europe | 6 | 8 | 0 | NO_STANDINGS_COVERAGE, THIN_BOOKMAKER_MARKET |
| 669 | 1. Liga Women | Czech-Republic | Europe | 1 | 4 | 0 | WOMENS_NEEDS_SENIOR_WOMENS_LANE, THIN_BOOKMAKER_MARKET |
| 346 | FNL | Czech-Republic | Europe | 1 | 7 | 8 | NO_STANDINGS_COVERAGE |
| 1244 | B-Liga Women | Denmark | Europe | 4 | 4 | 0 | WOMENS_NEEDS_SENIOR_WOMENS_LANE, THIN_BOOKMAKER_MARKET |
| 47 | FA Trophy | England | Europe | 40 | 0 | 7 | TOO_FEW_RECENT_RESULTS |
| 699 | Women's Championship | England | Europe | 6 | 6 | 5 | WOMENS_NEEDS_SENIOR_WOMENS_LANE |
| 69 | National 2 - Group C | France | Europe | 1 | 14 | 0 | THIN_BOOKMAKER_MARKET |
| 634 | NB III - Southwest | Hungary | Europe | 6 | 7 | 0 | THIN_BOOKMAKER_MARKET |
| 139 | Serie A Women | Italy | Europe | 6 | 6 | 9 | WOMENS_NEEDS_SENIOR_WOMENS_LANE |
| 355 | First League | Montenegro | Europe | 0 | 5 | — | NO_UPCOMING_FIXTURES, BOOKMAKERS_NOT_SAMPLED |
| 407 | Championship | Northern-Ireland | Europe | 0 | 8 | — | NO_UPCOMING_FIXTURES, BOOKMAKERS_NOT_SAMPLED |
| 408 | Premiership | Northern-Ireland | Europe | 0 | 6 | — | NO_UPCOMING_FIXTURES, BOOKMAKERS_NOT_SAMPLED |
| 104 | 1. Division | Norway | Europe | 1 | 9 | 0 | THIN_BOOKMAKER_MARKET |
| 786 | Liga III - Serie 3 | Romania | Europe | 4 | 6 | 0 | THIN_BOOKMAKER_MARKET |
| 789 | Liga III - Serie 6 | Romania | Europe | 3 | 6 | 0 | THIN_BOOKMAKER_MARKET |
| 649 | Supreme Division Women | Russia | Europe | 6 | 6 | 0 | WOMENS_NEEDS_SENIOR_WOMENS_LANE, THIN_BOOKMAKER_MARKET |
| 731 | Football League - Lowland League | Scotland | Europe | 4 | 16 | 0 | THIN_BOOKMAKER_MARKET |
| 644 | 3. liga - West | Slovakia | Europe | 7 | 8 | 0 | NO_STANDINGS_COVERAGE, THIN_BOOKMAKER_MARKET |
| 680 | Cup | Slovakia | Europe | 1 | 2 | 0 | TOO_FEW_RECENT_RESULTS, THIN_BOOKMAKER_MARKET |
| 736 | Elitettan | Sweden | Europe | 7 | 7 | 0 | WOMENS_NEEDS_SENIOR_WOMENS_LANE, THIN_BOOKMAKER_MARKET |
| 336 | Druha Liga | Ukraine | Europe | 6 | 8 | 1 | THIN_BOOKMAKER_MARKET |
| 334 | Persha Liga | Ukraine | Europe | 3 | 7 | 0 | THIN_BOOKMAKER_MARKET |
| 1164 | CAF Women's Champions League | World | International | 2 | 6 | 5 | WOMENS_NEEDS_SENIOR_WOMENS_LANE |
| 339 | Liga Nacional | Guatemala | North America | 5 | 6 | 0 | NO_STANDINGS_COVERAGE, THIN_BOOKMAKER_MARKET |
| 673 | Liga MX Femenil | Mexico | North America | 2 | 11 | 9 | WOMENS_NEEDS_SENIOR_WOMENS_LANE |
| 1242 | Primera Premier | Mexico | North America | 8 | 9 | 0 | THIN_BOOKMAKER_MARKET |
| 1130 | USL Super League | USA | North America | 3 | 5 | 9 | WOMENS_NEEDS_SENIOR_WOMENS_LANE |
| 190 | A-League Women | Australia | Oceania | 5 | 4 | 0 | WOMENS_NEEDS_SENIOR_WOMENS_LANE, THIN_BOOKMAKER_MARKET |
| 421 | Division di Honor | Aruba | Other | 3 | 5 | 0 | NO_STANDINGS_COVERAGE, THIN_BOOKMAKER_MARKET |
| 131 | Primera B Metropolitana | Argentina | South America | 4 | 0 | 7 | TOO_FEW_RECENT_RESULTS |
| 129 | Primera Nacional | Argentina | South America | 8 | 0 | 9 | TOO_FEW_RECENT_RESULTS |
| 1036 | Copa Santa Catarina | Brazil | South America | 2 | 2 | 0 | TOO_FEW_RECENT_RESULTS, THIN_BOOKMAKER_MARKET |
| 1135 | Sergipano - 2 | Brazil | South America | 2 | 9 | 0 | THIN_BOOKMAKER_MARKET |
| 1229 | Liga Women | Peru | South America | 1 | 2 | 0 | WOMENS_NEEDS_SENIOR_WOMENS_LANE, NO_STANDINGS_COVERAGE, TOO_FEW_RECENT_RESULTS, THIN_BOOKMAKER_MARKET |
| 282 | Segunda División | Peru | South America | 2 | 0 | 5 | TOO_FEW_RECENT_RESULTS |
| 268 | Primera División | Uruguay | South America | 5 | 1 | 10 | TOO_FEW_RECENT_RESULTS |
| 269 | Segunda División | Uruguay | South America | 1 | 6 | 1 | THIN_BOOKMAKER_MARKET |

### EXCLUDE, by first reason

- **BOOKMAKERS_NOT_SAMPLED** (53): 1. Liga Classic - Group 1 (Switzerland, 599); 1. Liga Classic - Group 3 (Switzerland, 601); 4. liga - Divizie A (Czech-Republic, 350); 4. liga - Divizie B (Czech-Republic, 351); 4. liga - Divizie C (Czech-Republic, 352); 4. liga - Divizie D (Czech-Republic, 353); 4. liga - Divizie E (Czech-Republic, 354); 4. liga - Divizie F (Czech-Republic, 686); Derde Divisie (Netherlands, 92); First Amateur Division (Belgium, 487); Gamma Ethniki - Group 7 (Greece, 582); III Liga - Group 1 (Poland, 780); III Liga - Group 2 (Poland, 781); III Liga - Group 3 (Poland, 782); III Liga - Group 4 (Poland, 783); Non League Premier - Isthmian (England, 58); Non League Premier - Northern (England, 59); Non League Premier - Southern Central (England, 931); Non League Premier - Southern South (England, 60); Oberliga - Baden-Württemberg (Germany, 753); Oberliga - Bremen (Germany, 749); Oberliga - Hessen (Germany, 750); Oberliga - Mittelrhein (Germany, 746); Oberliga - Nordost-Süd (Germany, 755); Oberliga - Rheinland-Pfalz / Saar (Germany, 752); Oberliga - Schleswig-Holstein (Germany, 744); Oberliga - Westfalen (Germany, 747); Primera División RFEF - Group 1 (Spain, 435); Primera División RFEF - Group 2 (Spain, 436); Regionalliga - Bayern (Germany, 83); Regionalliga - Nord (Germany, 84); Regionalliga - SudWest (Germany, 86); Regionalliga - West (Austria, 223); Second Amateur Division - ACFF (Belgium, 148); Segunda División RFEF - Group 1 (Spain, 875); Segunda División RFEF - Group 4 (Spain, 878); Serie D - Girone C (Italy, 428); Tercera División RFEF - Group 1 (Spain, 439); Tercera División RFEF - Group 10 (Spain, 448); Tercera División RFEF - Group 11 (Spain, 449); Tercera División RFEF - Group 12 (Spain, 450); Tercera División RFEF - Group 13 (Spain, 451); Tercera División RFEF - Group 15 (Spain, 453); Tercera División RFEF - Group 16 (Spain, 454); Tercera División RFEF - Group 18 (Spain, 456); Tercera División RFEF - Group 3 (Spain, 441); Tercera División RFEF - Group 4 (Spain, 442); Tercera División RFEF - Group 5 (Spain, 443); Tercera División RFEF - Group 6 (Spain, 444); Tercera División RFEF - Group 7 (Spain, 445); Tercera División RFEF - Group 8 (Spain, 446); Tercera División RFEF - Group 9 (Spain, 447); Tweede Divisie (Netherlands, 492)
- **NO_ODDS_COVERAGE** (46): 1. Division Women (Norway, 915); 1. Liga Classic - Group 2 (Switzerland, 600); 2. Frauen Bundesliga (Germany, 1034); 3. SNL - West (Slovenia, 795); AXA Women’s Super League (Switzerland, 739); Carioca - 2 (Brazil, 625); Championnat National (Benin, 415); Copa Federacion (Spain, 735); Copa Paraguay (Paraguay, 501); Copa Perú (Peru, 503); Eerste Divisie (Suriname, 568); Ekstraliga Women (Poland, 1033); Elite Two (Cameroon, 813); FA Women's Cup (England, 698); Football League - Highland League (Scotland, 730); Gamma Ethniki - Group 10 (Greece, 694); Gamma Ethniki - Group 2 (Greece, 577); Gamma Ethniki - Group 4 (Greece, 579); Gamma Ethniki - Group 9 (Greece, 693); Gaúcho - 3 (Brazil, 1150); Goiano - 3 (Brazil, 1133); I Liga - Women (Slovakia, 733); I-League (India, 324); Kvindeliga (Denmark, 638); League Cup (Hong-Kong, 1199); League Cup (United-Arab-Emirates, 302); Liga 1 Feminin (Romania, 728); Liga III - Serie 1 (Romania, 784); Liga III - Serie 2 (Romania, 785); Liga III - Serie 4 (Romania, 787); Liga III - Serie 5 (Romania, 788); Liga III - Serie 7 (Romania, 790); Liga III - Serie 8 (Romania, 791); Liga Premier Serie B (Mexico, 872); Ligue 1 (Burkina-Faso, 423); Ligue 1 (Congo-DR, 424); Ligue A (Burundi, 566); Mineiro - 3 (Brazil, 1142); Oberliga - Niederrhein (Germany, 751); Oberliga - Niedersachsen (Germany, 748); Pernambucano - 1 (Brazil, 622); Premier Division (Antigua-And-Barbuda, 1048); Third League - Northeast (Bulgaria, 175); Third League - Northwest (Bulgaria, 176); Third League - Southeast (Bulgaria, 177); WE League (Japan, 854)
- **YOUTH_COMPETITION** (14): 1. Liga U19 (Czech-Republic, 668); AFC U17 Asian Cup (World, 1012); CAF U23 Cup of Nations (World, 1015); Carioca U20 (Brazil, 1114); Central Youth League (Poland, 676); Júniores U19 (Portugal, 1041); Liga Revelação U23 (Portugal, 701); Paraense U20 (Brazil, 1157); Paulista - U20 (Brazil, 1086); U19 Bundesliga (Germany, 488); U20 Elite League (World, 890); UEFA U17 Championship - Qualification (World, 886); UEFA U19 Championship - Qualification (World, 893); UEFA U21 Championship - Qualification (World, 850)
- **RESERVE_OR_B_COMPETITION** (12): 1. Liga Promotion (Switzerland, 510); 3. liga - CFL A (Czech-Republic, 348); 3. liga - CFL B (Czech-Republic, 685); 3. liga - MSFL (Czech-Republic, 349); Copa Fares Lopes (Brazil, 1165); Diski Challenge (South-Africa, 734); NB III - Southeast (Hungary, 1023); Premier League Cup (England, 871); Reserve Pro League (Belgium, 518); Segunda División (Venezuela, 300); Segunda División RFEF - Group 2 (Spain, 876); Third League - Southwest (Bulgaria, 178)
- **SEASON_ENDED** (7): Copa Argentina (Argentina, 130); Copa De La Liga (Chile, 1220); King's Cup (World, 1038); Liga E Pare (Kosovo, 1195); Liga Panameña de Fútbol (Panama, 304); Ligue 1 (Senegal, 403); Primera C (Argentina, 132)
- **NO_STANDINGS_COVERAGE** (5): Oberliga - Bayern Nord (Germany, 938); Oberliga - Bayern Süd (Germany, 939); Oberliga - Hamburg (Germany, 745); Second Amateur Division - VFV A (Belgium, 149); Second Amateur Division - VFV B (Belgium, 150)
- **FRIENDLY** (1): Friendlies Clubs (World, 667)
## B. Structural discovery: the bounded evaluation lane

File: `src/lib/generation/evaluationLane.ts`.

**The problem.** On a healthy day, discovery never looks past CORE and
SECONDARY.

**The lane**, which runs on healthy days only:

- **Competitions:** registry additions (111, plus 112 as a priced cup) and the 30 new global inclusions, 32 in all. Nothing else.
- **Fixtures:** each must pass the same fallback quality gate as the thin-day sweep: senior, not started, at least 12h out, priced cup.
- **Price requirement:** a quote from at least `MIN_BOOKMAKERS` (5) is required. This is stricter than the thin-day sweep, which accepts a fixture that has no quote yet.
- **Volume caps:**
  - one fixture per competition per run;
  - 3 per run;
  - 8 per Lagos day;
  - at most one run every 3h;
  - never with less than 2,000 calls of quota left.
- **No displacement and no publication:**
  - the worker already orders uncatalogued and DEEP_FALLBACK fixtures after every catalogued one, so a lane fixture cannot take a better candidate's generation slot;
  - ordinary generation persists `PENDING_REVIEW`, so the lane never publishes anything;
  - no confidence or market-evidence requirement is lowered;
  - there is no geographic quota.

**`COVERAGE_ROLLOUT` modes**

| Mode | Behaviour |
|---|---|
| `off` | The lane does not run |
| `shadow` (default) | Fetches the by-date payload and **records** what it would have shortlisted in the discovery JobRun (`coverage.lane`). No odds calls and no queueing |
| `on` | Also checks odds for up to 3 fixtures per run, queues what qualifies, and the worker admits lane competitions on healthy days |

**What it should find.** The 31 included competitions offer about 65 fixtures
a day. The daily cap of 8 means at most about 12% of them can be evaluated.
Only those with a confirmed price of 5 or more bookmakers at run time
qualify. The shadow record will measure how many actually do.

## C. API cost

| Item | Calls |
|---|---|
| Lane, `shadow` (default) | ≤2 per run × 8 runs = **≤16/day** (0.2% of 7,500) |
| Lane, `on` | ≤(2 + 3) × 8 = **≤40/day** (0.5%), plus normal generation for at most 8 fixtures/day (about 5–10 calls each, cache-dependent) |
| Thin-day sweep | Unchanged |
| Registry | 0 extra calls: the existing payload is reused |
| Explorer and diagnostics | Database only |
| Global probe | ≤150 per manual run (83 used in run 45) |
| All probes during this work | About 400 calls in total, across 4 runs on 13 Nov |

**Merging in the default shadow mode adds at most 16 calls a day.** That is
the only live behaviour change on merge. `COVERAGE_ROLLOUT=off` removes it.

## D. VIP / Premium: why the first filter failed, and what was tested

Script: `scripts/research-paid-policy.ts`. Pure logic: `src/lib/paidPolicyResearch.ts`.

**Method**

- **Data:** 1,695 settled singles over 150 days.
- **Periods:** dev-train 847, dev-validate 338 (from 3 Oct), and an untouched **final holdout** of 510 (from 18 Oct).
- **Diagnosis** reads the development period only.
- **Hypotheses** are subsets of the existing selection (they can only remove picks). They and the promotion rule were committed (`ae19c70`) before the first run.
- **Promotion rule** (on dev-validate, with a dev-train sign check):
  - n ≥ 30;
  - keeps ≥ 50% of picks;
  - win rate ≥ baseline;
  - closing-reference ROI gain ≥ 1pp;
  - dev-train gain > 0.
- **Holdout:** only promoted hypotheses are scored there, once. Holdout figures for the others were never computed.
- **Returns** are at the last pre-kickoff quote. They are a **closing reference**, not entry prices and not realized returns.

**Why quality-first underperformed** (VIP, development period, 372 existing picks)

| Finding | Evidence |
|---|---|
| The loss came from what it **added**, not what it removed | Picks in both sets: n=102, 83.3%, −2.7%. Removed existing picks: n=270, 76.4%, −5.4% at mean odds 1.35. **Added from outside the feed: n=145, 80.0%, −7.2%** |
| The 87% market-probability cap removed the existing feed's best band | Market ≥87%: n=38, 100% win, +5.7%. 75–87%: 82.9%, −3.6%. **Under 75%: 63.8%, −8.6%** |
| Price | Odds <1.15: 91.9%, −0.0%. Odds ≥1.50: 52.4%, **−13.9%** |
| Confidence is roughly calibrated, but less sharp than the market | Gaps: 75–79 −0.7pp; 80–84 +3.8pp; 85–89 +0.6pp. Brier score: model 0.1717 vs market 0.1569 (lower is better) |
| Competitions | CORE 80.0%, SECONDARY 78.0%, FALLBACK 63.3% (n=30), DEEP_FALLBACK 84.2% (n=19, too small) |
| Missing prices | 95 of 372 existing picks unpriced. Their win rate (81.5%) is not worse |
| Correlation | Picks sharing a league kickoff slot with 2 or more others win at the same rate as isolated picks (78.0% vs 77.7%) |
| **VIP vs Premium** | **Every one of the 304 Premium development picks is also a VIP pick.** Premium is not a separate selection today, and Premium's dev-validate sample is 16 picks |

**Hypotheses on development data**

| Hypothesis | VIP dev-validate, vs baseline (n 74, 83.1%, −3.6%) | Outcome |
|---|---|---|
| H1 priced only | 78.9%, −3.6% | not promoted |
| H2 model/market agreement ≤10pp | 84.5%, −4.8% | not promoted |
| H3 drop odds <1.10 | 82.3%, −3.1% | not promoted |
| **H4 diversified** (one per fixture, ≤2 per league slot) | 86.4%, −1.4% | **promoted** |
| H5 = H2 + H4 | 84.9%, −4.9% | not promoted |

For Premium, no hypothesis could be promoted: dev-validate has only 16 picks.

**Final holdout (VIP)**

| Selection | n | Win (95% Wilson) | Closing-reference ROI |
|---|---|---|---|
| Baseline | 145 | 83.3% (76.4–88.5) | −2.0% |
| H4 | 117 | 81.9% (73.9–87.8) | −2.8% |
| H4's removed picks | 28 | 89.3% | — |

**Verdict: NO_CREDIBLE_IMPROVEMENT.** The removed picks did *better* than the
ones kept.

**Premium final holdout (baseline only):** n=33, 90.9% (76.4–96.9),
closing-reference +2.7%. That is too few picks to support any profitability
statement.

**Conclusion.** No alternative earned activation, and the existing VIP and
Premium selection is retained. The development diagnosis suggests three
hypotheses: the market-under-75% band, odds of 1.50 or more, and the
market-87%-plus band. They were formed from this history, so judging them on
it would be circular. They are recorded per candidate in the shadow log
(`prospectiveFlags`, `prospective-s05-v1`), to be judged **only** on records
written after merge.

## E. Diagnostics: the competition coverage explorer

`/admin/paid-ops?competition=<id>` replaces the Wales-only panel. Access is
admin-only (admin layout), and the id is validated as a bounded integer.

For **any** provider id, it answers:

- Was the fixture available from API-Football? (audit or registry evidence)
- Was the league excluded or outside the active tier?
- Was a fixture evaluated? (ledger, plus lane shortlists)
- What evidence was missing?
- Why was a candidate rejected? (fallback gate, and quality decisions per competition)
- Did the existing policy select it?
- What would the proposed policy have done? (shadow sweeps and the quality layer)

The page also shows the global audit table, with WATCH and INCLUDE linked
into the explorer.

## F. Controls (independent; all default to shadow or disabled)

| Control | Values | Default | Governs |
|---|---|---|---|
| `COVERAGE_ROLLOUT` | off / shadow / on | shadow | Discovery: registry, fair ordering, evaluation lane |
| `PAID_QUALITY_POLICY` | off / shadow | shadow | Whether the quality layer is recorded. **There is no "on"**: activation needs a reviewed code change |
| `PAID_SELECTION_MODE` | current / shadow / value | shadow (unchanged) | VIP / Premium qualification (Sprint 02) |

## G. Tests (continuation)

| Check | Result |
|---|---|
| `check-league-coverage-quality` | 126/126 (44 new) |
| `check-adaptive-coverage` | 120 checks, adds the lane against stubs: lease held means no calls; shadow makes ≤2 calls and queues nothing; off makes no calls; only lane competitions are shortlisted |
| `check-vip-premium-overlay` | 228 |
| `check-european-clubs`, `check-generation`, `check-goals-generation` | pass |
| Paid selection, value integration, market quality, subscriber, render | pass |
| Subscription, Paystack and one-time entitlement | pass |
| `tsc` | clean |
| Preflight | 86/89. The 3 failures are master's baseline (house banners, goals category, sitemap scoping) |

New areas covered:

- the global registry and decision consistency;
- eligibility rules, including geography independence;
- the lane's budget, caps and shadow isolation;
- worker admission;
- the three controls;
- period separation;
- the subset-only hypotheses;
- the promotion and holdout rules;
- holdout-once scoring;
- prospective flags;
- the explorer and its input validation.

## H. Deployment, rollback, recommendation

**Deploy**

- No schema change and no migration.
- On merge, the only live change is the shadow lane: ≤16 calls a day, one AppLock row, and extra JobRun detail.

**Activation (needs owner approval)**

1. After about 2 weeks, read `coverage.lane` in `/admin/paid-ops`: the shortlisted competitions and the share priced at 5 or more books.
2. Then consider `COVERAGE_ROLLOUT=on`. The quality policy stays shadow regardless.

**Rollback**

- `COVERAGE_ROLLOUT=off` stops the lane and the proposed rules immediately.
- `PAID_QUALITY_POLICY=off` stops the quality record.
- Revert for everything else.
- Lane-queued fixtures are excluded from generation again as soon as the lane is off.

**Limitations**

- The audit is one 2-day snapshot. Competitions between matchdays were not seen.
- Bookmaker samples are 1 fixture per competition, so they are thin.
- WATCH needs re-probing.
- Closing prices are not entry prices, and no entry-priced sample exists yet.
- Premium is a subset of VIP, with 33 holdout picks.
- The prospective hypotheses need about 4–6 weeks of post-merge records.

**Recommendation**

- Merge, with the lane in shadow.
- Keep the existing VIP and Premium selection. No alternative demonstrated improvement.
- Revisit lane activation and the prospective hypotheses with post-merge evidence only.
