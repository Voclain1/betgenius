# VIP/Premium Sprint 09: where the football calendar is lost on the way to VIP/Premium (14 Nov 2026)

All production evidence is read-only. It comes from `diagnose-generation` on this branch, job `qualification`, step "Paid opportunity loss":

- run **43650184276** (#48);
- run **43650465700** (#49);
- run **43651207202** (#50);
- run **43651535912** (#51), which adds section K.

Each run's session was verified `transaction_read_only = on`, and the step made 0 provider calls. Kickoffs covered: **15 Oct – 14 Nov 2026** (30 days, settled past only). Unique fixtures throughout.

The JobRun records of the dedicated pass are used only for what a run **decided at the time**: its recorded `widened` scope flag. They are never used as fixture counts.

Reproduce: `npm run measure:paid-opportunity -- 30`, or Actions → diagnose-generation (`days=30`, `qualification_only=true`).

**Closing reference.** "Lopsided" and "in band" use the fixture's last **pre-kickoff** quote. That shows how the market finally priced the fixture. It does not show that the pass could have read that price 12–24h out, and no claim below depends on that.

## 1. The calendar, by tier and paid scope

| Scope group / tier | Discovered | Covered | Ordinary published | Best ordinary pick ≥ 75 | Lopsided ≥ 75 (closing) | Dedicated attempts | Promoted | **VIP** | **PREMIUM** |
|---|---|---|---|---|---|---|---|---|---|
| PAID_CORE / CORE (12 leagues + UCL/UEL/UECL) | 451 | 421 | 318 | 132 | 176 | 156 | 66 | **155** | **32** |
| PAID_WIDENED / SECONDARY (men's SECONDARY + national teams) | 774 | 749 | 575 | 223 | 231 | 38 | 11 | **12** | **5** |
| OUTSIDE / SECONDARY (senior women's) | 121 | 119 | 92 | 34 | 47 | 0 | 0 | 0 | 0 |
| OUTSIDE / FALLBACK | 208 | 179 | 149 | 46 | 84 | 0 | 0 | 0 | 0 |
| OUTSIDE / DEEP_FALLBACK | 23 | 17 | 28 | 3 | 17 | 0 | 0 | 0 | 0 |

**Totals: VIP 167 fixtures** (77 from dedicated picks) and **PREMIUM 37**. Discovery and analysis are not where the calendar is lost:

- 7 of 1,178 covered paid-scope fixtures were generated inside 12h of kickoff;
- no paid-scope fixture reached kickoff unattempted by ordinary generation.

### First loss per covered fixture (`firstPaidLoss`, pipeline order)

| First loss | Fixtures | Intentional? | Code path |
|---|---|---|---|
| VIP | 151 | — | — |
| **WIDENED_SCOPE_HEALTHY_DAY**: widened-scope league, and the pass never widened while the fixture was in its window | **612** | Yes, by design. Partly avoidable: see §4 | `paidScopeFor` (`vipPremiumOverlay.ts`); ordinary curation `assessPaidCuration` (`NOT_VIP_ROUTE`) |
| OUTSIDE_PAID_SCOPE: FALLBACK, DEEP_FALLBACK, senior women's | 314 | Yes | `PAID_ANY_LEAGUE_IDS` |
| MARKET_BELOW_BAR: no Match Winner or Double Chance side ≥ 75 at close, so never targeted | 292 | Yes (deliberately narrow targeting: `TARGETABLE_SELECTIONS` in `marketConfirmed.ts`) | `qualifyVipPremiumTargets` |
| GATE_REJECTED: attempted, a draft ≥ 75 failed the gate (gap, band, books, repeat) | 52 | Yes | `evaluateMarketConfirmed` / `paidTierFor` |
| MODEL_BELOW_FLOOR: attempted, every draft < 75 | 40 | Yes | `paidTierFor` |
| NOT_ATTEMPTED_IN_SCOPE: in scope and lopsided at close, never attempted | 23 | Not proven either way | See §5 |

## 2. Established leagues: why "suitable" matches miss the paid feeds

**Core** (Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Championship, the cups, European club competitions):

- 155 VIP from 421 covered fixtures.
- The main loss is **MARKET_BELOW_BAR**: Championship 36, Copa del Rey 28, Serie A 24, Ligue 1 22, Premier League 20. These are balanced matches the targeting rule does not chase.
- Attempts convert at **42%**. 128 of 156 attempted fixtures produced a draft ≥ 75, and the gate then decides.
- On quota-spent days only **3** lopsided core fixtures were left unattempted in 30 days.

**Medium leagues in paid scope** (Eredivisie 35 covered, Ekstraklasa 35, Allsvenskan 37, Süper Lig 36, Primeira Liga 28, Belgian Pro League 27, Super League 1 27, Saudi Pro League 27, Scottish Premiership 27, Czech Liga 31, Eliteserien 29):

- Almost every fixture's first loss is WIDENED_SCOPE_HEALTHY_DAY. Example: Eredivisie 34 of 35.
- Both paid paths exclude them on healthy days:
  - **Dedicated pass:** scope is `PAID_CORE_LEAGUE_IDS` unless the 12–48h window has fewer than 3 covered core fixtures.
  - **Ordinary curation:** only VIP-route picks (core) are admitted on healthy days.
- This is intentional and **supported by evidence for ordinary picks**. Sprint 08's V4 admitted market-confirmed ≥ 75 ordinary picks from these leagues on any day. The added picks struck 77–78% and lost about 10% at closing reference in both development periods.

**Analysed for free, never evaluated for paid.** 749 widened-scope fixtures were analysed. Only 38 ever got a dedicated attempt, all on thin days. That is a **design restriction, not a missing step or a defect**: no code path is skipping an evaluation it was meant to run. §4 is the one place the restriction costs supply for no reason.

## 3. Confidence and market distribution

**Ordinary published singles at confidence ≥ 75, by provider:**

| Provider | Core | Widened | Outside |
|---|---|---|---|
| anthropic | 5% (7 of 141) | 7% (17 of 254) | 7% (12 of 174) |
| gemini | 59% (118 of 200) | 50% (192 of 386) | 57% (58 of 102) |
| groq | 29% | 42% | 27% |

**The provider is the single largest driver of ordinary paid supply.** Ordinary VIP picks require ≥ 75. Since Claude became primary (31 Oct), about 5–7% of its picks clear that floor against 50–59% of Gemini's. The floors are part of the published subscriber promise and were not changed. `PAID_ROUTE_PRIMARY_PROVIDER` already exists and is unset; using it is an owner decision. Run 46 also shows 84 ledger rows ABANDONED in 30 days with Gemini returning "prepayment" errors, so check Gemini credit before considering it.

**Dedicated drafts by market** (the model chooses the market; targeting chooses the fixture):

| Market | Drafts | Below 75 | Promoted |
|---|---|---|---|
| Over/Under | 187 | 77 | **60** |
| Draw No Bet | 128 | 74 | 14 |
| Double Chance | 54 | 38 | 2 |
| BTTS | 40 | 37 | 0 |
| Match Winner | 8 | 1 | 1 |

- The pipeline is **not** narrowly limited to one market at the gate. The model drafts five market types, and goals lines dominate what passes.
- **Targeting** is narrow on purpose: Match Winner and Double Chance sides only. Goals markets were excluded after the first version targeted "Over 0.5 at 92.7%" (see `TARGETABLE_SELECTIONS`).
- **The pool targeting skips (section K, closing reference).** Of the 211 core MARKET_BELOW_BAR fixtures, **124** had a goals selection priced in the paid band (75–87%, ≥ 5 books): Over 1.5, Under 3.5, Over/Under 2.5, or BTTS Yes/No. The widened-scope figure is 26 of 81. That is about 4 a day, which dwarfs §4.
- Whether the model would draft ≥ 75 on balanced fixtures **cannot be known without attempting them**. A shadow record cannot measure it, because a model call is the measurement. No alternative-market prediction was fabricated or inferred.
- This is the largest untested lever. It needs an owner-approved, bounded experiment, for example 2 extra attempts a day for 2 weeks on band-qualified goals fixtures under the unchanged gate. It is not part of this PR.

**Promotion rate by the attempted fixture's closing headline:**

| Closing headline | Attempts | Promoted |
|---|---|---|
| 75–79 | 53 | 32% |
| 80–86 | 77 | 47% |
| 87–91 | 41 | 44% |
| ≥ 92 | 12 | 33% |

Fixture ordering (strongest market first within a day) is not shown to cost supply. The ≥ 92 sample is 12, and quota binds on very few lopsided core fixtures (3 in 30 days).

## 4. Confirmed avoidable gap: spare kickoff-day quota on "healthy" days

**Failure.** The thin-day test (`paidScopeFor`) asks one question for the whole 12–48h window: are there fewer than 3 covered core fixtures? A day with 4–6 core fixtures is therefore "healthy", and its widened-scope fixtures are never in scope. That holds even when those core fixtures use 1–2 of the day's 8 attempts.

**Root cause.**

- Scope is decided per window, but the quota is spent per kickoff day.
- The scope test counts covered core fixtures, not core fixtures that could use the quota.
- Ordinary curation already decides thin days per Lagos day (`paidCurationWidened`).

**Measured** (section I, reserving one slot for **every** core fixture of the day not attempted, so core could never have been displaced):

| Kickoff day | Core covered | Attempts | Core never attempted | Widened lopsided out of scope | Spare slots | VIP that day |
|---|---|---|---|---|---|---|
| 19 Oct | 4 | 1 | 3 | 5 | 4 | 2 |
| 23 Oct | 6 | 2 | 4 | 6 | 2 | 3 |
| 30 Oct | 6 | 2 | 4 | 2 | 2 | 3 |
| 2 Nov | 4 | 1 | 3 | 3 | 3 | 1 |
| 6 Nov | 6 | 2 | 4 | 5 | 2 | **0** |
| **Total** | | | | | **13** | |

**Quality of what would be admitted.** Settled dedicated picks since the paid-tier cutover, from section H. Entry prices were not recorded on these rows, so this is strike rate only:

| Scope | Tier | W–L | Strike (95% CI) | Mean market at promotion |
|---|---|---|---|---|
| Core | VIP | 70–14 | 83.3% (74–90) | 81.7% |
| Widened | VIP | 16–3 | 84.2% (62–94) | 81.3% |
| Core | PREMIUM | 32–5 | 86.5% | — |
| Widened | PREMIUM | 6–2 | 75.0% (n=8, unreadable) | — |

**Expected impact.**

- At most 13 extra attempts a month.
- At the 29% conversion widened attempts achieved on thin days (11 of 38), that is about **3.8 extra VIP picks a month, an upper bound**. All of them fall on days that had 0–3 VIP picks.
- This is small. It is not a fix for thin supply in general.

**Correction implemented, disabled by default.** `PAID_SPARE_QUOTA_WIDENING = off | shadow (default) | on`, in `vipPremiumOverlay.ts` and `vipPremiumPipeline.ts`.

- **Spare slots:** `spareQuotaSlotsByDay` gives `quota − attempts used − one slot per core fixture of the day still attemptable`. "Attemptable" means not attempted, not ABANDONED, and kickoff more than 12h away. Core rows are read through the end of the last Lagos day the window touches, so a day's later core fixtures are reserved before any of them enters the window.
- **shadow:** live candidates and every existing counter are unchanged. Each run's JobRun gains `vipPremium.spareQuota`: slots per day, eligible widened fixtures, how many the **already cached** quote would qualify, and up to five of them. **No odds call and no model call.**
- **on:** those fixtures become candidates, flagged `viaSpareQuota`.
  - Warming prices in-scope candidates first.
  - `qualifyVipPremiumTargets` never lets a day take more spare targets than its slots.
  - Fresh quote, books, market floor, 87% cap, model floors, gap, repeat refusal, auto-publish checks, the 8-per-kickoff-day quota and the 12-a-day spend cap are all unchanged.
  - The competitions are the ones the pass already targets on thin days, and they are already inside the auto-publish scope (`PAID_ANY_LEAGUE_IDS`).
- **API cost:**
  - shadow: 0 calls, and one extra indexed read of core ledger rows per run.
  - on: at most 13 extra attempts a month in the measured window. Each is one model call plus the usual context fetches, under the same paid-priority budget. Odds warming stays inside the existing 12-per-run limit, core first.

## 5. NOT_ATTEMPTED_IN_SCOPE (23 fixtures): no avoidable cause proven

These fixtures were in scope and lopsided **at the closing quote**, but never attempted. Possible causes:

- 3 fell on quota-spent days;
- some were lopsided only near kickoff, after the 12h window closed;
- some had no fresh quote while in the 12–24h warm band;
- some were held by backoff.

Per-fixture targeting state is not stored, so the split between these causes cannot be reconstructed without post-kickoff information. **Not claimed as a defect.**

## 6. Dry days (≤ 2 VIP fixtures), reconstructed from pre-kickoff records

| Day | VIP | PREM | Covered core / widened / other | Core lopsided | Attempts (core / widened) | Drafts ≥ 75 | Promoted | Verdict |
|---|---|---|---|---|---|---|---|---|
| 16 Oct | 0 | 0 | 2 / 10 / 13 | 0 | 0 / 0 | 0 | 0 | **Low opportunity**: thin, widened in time, nothing lopsided |
| 19 Oct | 2 | 0 | 4 / 9 / 13 | 1 | 1 / 0 | 0 | 0 | **Avoidable in part**: 4 spare slots, 5 widened lopsided out of scope (§4) |
| 20 Oct | 2 | 0 | 10 / 5 / 17 | 7 | 7 / 0 | 6 | 1 | **Model and gate**: 6 drafts ≥ 75, 1 promoted |
| 26 Oct | 2 | 0 | 1 / 8 / 15 | 1 | 1 / 2 | 2 | 1 | Low opportunity: thin, widened in time |
| 2 Nov | 1 | 0 | 4 / 11 / 7 | 1 | 1 / 0 | 1 | 1 | **Avoidable in part**: 3 spare slots (§4) |
| 3 Nov | 2 | 1 | 18 / 4 / 4 | 4 | 3 / 0 | 2 | 1 | Model and gate; 14 core fixtures not lopsided |
| 6 Nov | 0 | 0 | 6 / 12 / 9 | 2 | 2 / 0 | 1 | 0 | **Avoidable in part**: 2 spare slots, 5 widened lopsided out of scope (§4) |
| 9 Nov | 0 | 0 | 0 / 1 / 14 | 0 | 0 / 0 | 0 | 0 | **Low opportunity** (international break) |
| 10 Nov | 2 | 0 | 0 / 0 / 20 | 0 | 0 / 0 | 0 | 0 | **Low opportunity**: no paid-scope fixture at all |
| 11 Nov | 0 | 0 | 0 / 1 / 7 | 0 | 0 / 0 | 0 | 0 | **Low opportunity** |
| 14 Nov | 2 | 2 | 0 / 14 / 11 | 0 | 0 / 8 | 3 | 2 | Quota spent on widened; 5 of 8 attempts below the model floor |

**Totals**

- **Genuinely low opportunity: 5 days** (16 Oct, 26 Oct, 9, 10 and 11 Nov).
- **Avoidable in part: 3 days** (19 Oct, 2 and 6 Nov), plus 23 and 30 Oct, which reached 3 VIP picks.
- **Model or gate: 3 days** (20 Oct, 3 and 14 Nov).
- Not one dry day was caused by discovery, lead time, API budget or publication.

## 7. Candidate prioritisation and the API budget

- **Ordering:** soonest kickoff day, then strongest market. On the 12 quota-spent days, only 3 lopsided core fixtures were left unattempted. No prioritisation change is justified.
- **API budget:** api-football reaches the 7,400-call ceiling on most days (Sprint 08). In 30 days, no paid-scope fixture was lost to the budget:
  - discovery covered 1,170 of 1,225 paid-scope fixtures;
  - 7 were generated late;
  - the dedicated pass stands down only 20:00–00:59 Lagos.
- **Generation cost:** dedicated attempts go only to fixtures the market already rates lopsided. 82% of attempted core fixtures produced a draft ≥ 75. Capacity is not wasted on unlikely fixtures.

## 8. The coverage expansion (31 inclusions and the evaluation lane)

- **Why they are excluded from paid eligibility.** None of the 32 lane competitions is in `PAID_ANY_LEAGUE_IDS` (`vipPremiumOverlay.ts`). The lane exists to evaluate free coverage under `COVERAGE_ROLLOUT`. Paid eligibility is a separate list, and Sprint 05 deliberately did not widen it.
- **Historical evidence for paid selection:** none.
  - BetGenius has **0** settled predictions in any of the 31 competitions (the Sprint 05 audit: 0 existing predictions per competition).
  - The lane has queued nothing (shadow).
  - With no settled record, no competition can be considered for paid selection. That is a data limit, not a judgement on the competitions.
- **Decisions stay separate:** discovery (`COVERAGE_ROLLOUT`, shadow), ordinary generation (lane admission only when `on`) and paid eligibility (`PAID_ANY_LEAGUE_IDS`, unchanged). Nothing is activated.

## 9. Delivery summary

| | |
|---|---|
| **Confirmed defects** | None in the sense of code doing something other than intended. One **confirmed avoidable opportunity loss**: spare kickoff-day quota on healthy days (§4), from window-level scoping meeting per-day quota |
| **Intentional restrictions** | Healthy-day paid scope = core (612 fixtures; ordinary-pick evidence supports it). Paid scope excludes FALLBACK, DEEP_FALLBACK and women's (314). Lopsidedness-only targeting (292). Model 75 / 80 floors (40). Market gate (52). 8 attempts per kickoff day. 12 a calendar day |
| **Low-opportunity days** | 16 Oct, 26 Oct, 9, 10 and 11 Nov |
| **Missing historical evidence** | Per-fixture targeting state for in-scope fixtures never attempted (23). Model behaviour on balanced fixtures (never attempted). Entry prices on most dedicated picks. Any record in the 31 new competitions. Settled sample of widened-scope dedicated picks (n=20 VIP, 8 PREMIUM) |
| **Corrections implemented** | `PAID_SPARE_QUOTA_WIDENING`, default **shadow** (records only). Audit tooling: `scripts/measure-paid-opportunity.ts`, `src/lib/paidOpportunity.ts` |
| **Rejected for insufficient evidence** | Widening the healthy-day scope to all widened leagues: ordinary picks lose about 10% (Sprint 08), and the dedicated sample is n=20. Goals-market targeting: the pool is 124 core fixtures a month at the closing quote, but model yield on balanced fixtures is unknown, and measuring it needs an approved experiment that spends model calls. Reordering by market band: n=12. Paid eligibility for any of the 31 inclusions: no record. Raising the dedicated quota: quota binds on 3 lopsided core fixtures a month |
| **Expected vs verified impact** | Expected: ≤ 3.8 VIP a month, on dry days, once `on`. Verified: none yet. Shadow records the would-be targets from today, at real point-in-time quotes. Ordinary-pick supply is driven by provider confidence (§3), an owner decision outside this change |

## 10. Activation, rollback, risk

- **Deploy:** no schema, migration, cron or environment change. The default is shadow, so live paid selection is unchanged.
  - Each dedicated run adds `vipPremium.spareQuota` to its JobRun detail.
  - Each run adds one database read of core ledger rows.
- **GO / NO-GO for `PAID_SPARE_QUOTA_WIDENING=on`: NO-GO until reviewed against shadow.**
  - After about 2 weeks, read `spareQuota` in the `generate-vip-premium` JobRuns.
  - Review the days with slots, the eligible fixtures, and the share qualified from cache.
  - With owner approval, set `PAID_SPARE_QUOTA_WIDENING=on` and watch `measure-vip-premium` and `measure-paid-opportunity` §H for widened-scope dedicated picks.
- **Rollback:** `PAID_SPARE_QUOTA_WIDENING=off` (no deploy), or revert. Picks already published stay as published records.
- **Risk:** in `on`, a widened pick can take a slot only after one slot is reserved for every attemptable core fixture of the day. A core fixture discovered later than the reservation read would not be reserved. Ledger rows exist about 45h before kickoff and the window starts at 48h, so this is unlikely but not impossible.
