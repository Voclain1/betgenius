# Early Prediction Engine — Deep Audit (22 November 2026)

Audit period requested: 15–21 November 2026 (WAT), plus 22 November partial.
Companion reports: [API-Football 7-day usage](API_FOOTBALL_7_DAY_USAGE_REPORT.md) · [Remediation](EARLY_ENGINE_REMEDIATION_REPORT.md).

---

## 0. Evidence basis: read this first

| Source | Available to this audit? | Notes |
|---|---|---|
| Repository code, cron configuration, CI | **Yes** | Every root cause below is confirmed in code, with file references. |
| Production database (JobRun, GenerationAttempt, UpcomingFixture, AIJob, Prediction, ApiUsage) | **No** | No credentials in the audit environment. Diagnosis was required to be read-only, so no access was requested to work around this. |
| Production website / public endpoints | **No** | The audit environment's egress proxy refused `www.betgenius.ng` (HTTP 403 on CONNECT). |
| API-Football account dashboard / `/status` | **No** | No key. `/status` has no history anyway. |
| Earlier production measurements recorded in this repository | **Yes** | Cited with their dates where used; they predate the audit window. |

**Consequence.** No count in this report is presented as a 15–21 November production measurement, because none could be taken. Where the brief asks for a production number, the table says *not measured* and names the read-only query that produces it. Two read-only scripts were written for that purpose (§7). Quantitative claims that are made come from one of three sources, always labelled:

- **Code-derived:** a bound or rate that follows from the configuration (for example, "at most 192 early `/odds` calls a day").
- **Simulated:** the offline replay in `scripts/simulate-early-freshness.ts`, which models the cache-age process the code defines (`docs/audit/early_freshness_simulation.csv`).
- **Historical (repository):** a production figure recorded earlier in this repository, with its date.

---

## 1. How the early engine works today (reconstructed from code)

```
cron (VPS, UTC; deploy/ops/crontab)        cron-job.org (Lagos time, docs/GENERATION_SCHEDULING.md)
 :03 :33  early-discover?batch=4  ─┐        :05 :20 :35 :50  generate/run?vipPremium=1   ┐
 :06 :36  early-odds?limit=4       │        :10 :25 :40 :55  generate/run (ordinary)       ├ share the
 :09 :39  early-run?limit=3  ◄─────┼────────────── same "generation-run" lease ───────────┤ lease
 :16 :46  early-publish?limit=16   │        :15 :45          generate/run?european=1      ┘
 :06 :21 :36 :51 reassess?limit=3  │        :08 :23 :38 :53  refresh-insights
                                   │        (+ refresh-enrichment/{teams,leagues,h2h,odds,…}, settle, …)
```

| Stage | Code | Provider calls | What it does |
|---|---|---|---|
| Discovery | `earlyFixtureDiscovery.ts` | ≤4 `/fixtures` per pass (+ `/leagues` season lookups for CORE/SECONDARY, cached 6h in-process) | 1 regional spotlight league + 2 CORE/SECONDARY cursor leagues + 1 FALLBACK league per pass; horizon 14/10/7/5 days by tier. Writes `UpcomingFixture`; queues new `GenerationAttempt` rows and stamps `earlyQueuedAt`. |
| Odds warming | `earlyOdds.ts` | ≤4 `/odds` per pass | Lead-aware refresh (12h/8h/3h) and missing-price retry (12h/6h/3h). |
| Generation | `earlyGeneration.ts` → `worker.runGeneration` | **0** (`withNoFootballApiCalls`, `cacheOnly`) | Up to 3 fixtures per run, priced first, 22s soft deadline. One model call per fixture. |
| Publication / triage | `earlyPublication.ts` | 0 | Re-triages every early `PENDING_REVIEW`/held `DRAFT`: auto-publish, admin review, or hold. |
| Evidence caches | `enrichment.ts` + `refresh-enrichment/*` | Per workload limits (cron-job.org) | Team caches tiered by next kickoff: ≤24h → 3h, ≤72h → 12h, beyond → **48h** (`REFRESH_TIERS`). |

Automatic publication (`earlyPublicationBlock` + atomic publisher) requires **all** of: dedicated early FREE job, 48h–horizon window, `contextComplete`, valid single market, confidence ≥ 70, both teams with season stats and ≥3 recent matches, and an exact fresh bookmaker quote (3/4/5 books by lead time, median ≥ 1.12).

---

## 2. Issue 1 — Do early predictions use outdated football data?

### 2.1 Source of each evidence category (Part 1, Q1–Q3)

| Evidence | Where the early lane reads it | Written by | Freshness rule BEFORE this change (cache-only lane) | Freshness rule AFTER |
|---|---|---|---|---|
| Recent form (last 5, all competitions) | `TeamEnrichmentCache.teamDigestJson` | `refreshTeamCache` (`/fixtures?team&last=5`) | >12h ⇒ `stale` | Lead tolerance (3h/12h/48h, = `REFRESH_TIERS`) **and** no known match played since the latest match in the evidence |
| Season statistics, goals averages, clean sheets | same digest | `/teams/statistics` | >12h ⇒ `stale` | same as above |
| Injuries / suspensions (availability) | same digest (`availability`, `availabilityAsOf`) | `/injuries` | >12h ⇒ `stale` | same; publication never presents unknown availability as "fit" (unchanged) |
| League standings | `LeagueEnrichmentCache.standingsJson` | `refreshLeagueCache` | >24h ⇒ `stale` | 24h inside 72h, 48h beyond |
| Head-to-head | `H2HCache` | `refreshH2HCache` | any age accepted | unchanged: refreshed by event (a newer meeting), no age floor |
| Domestic table (cup ties) | `LeagueEnrichmentCache` (≤14 days) | league workload | ≤14 days | unchanged |
| Coach | `TeamEnrichmentCache.coachJson` (≤14 days) | squads workload | ≤14 days | unchanged |
| Odds | `FixtureOddsCache` | `refreshOddsCache` | provider `update` age by lead (24h/12h/6h) | unchanged |

Live API responses are **never** used by the early lane; everything is a previously refreshed cache. Ordinary and paid lanes refresh on a miss (12h/24h floors), and that behaviour is unchanged.

### 2.2 Findings

| Field | Finding |
|---|---|
| **Problem** | Early drafts were frozen as `contextComplete=false` whenever any cached part was older than a flat 12h/24h floor. That flag (a) blocks automatic publication permanently (`earlyPublicationBlock` → `no-reliable-evidence`) and (b) makes the draft "not credible" for triage, so drafts were held until 72h and then sent to admin review. Separately, freshness was judged by age alone: a young cache missing a match played since passed as complete. |
| **Severity** | **Critical** for publication throughput; **High** for quality (the supersession gap). |
| **Evidence** | `generationContext.ts` (pre-change): `TEAM_DIGEST_MAX_AGE_MS = 12h`, cache-only branch pushes `stale`. `generate.ts`: `contextComplete = … && !sources.stale?.length` for early intent. `enrichment.ts`: `REFRESH_TIERS` C = 48h for fixtures >72h. `earlyPublication.ts`: `if (!row.contextComplete …) return "no-reliable-evidence"`, and `credibleEvidence` requires `contextComplete`. `contextComplete` is written once at generation and never recomputed. |
| **Root cause (confirmed)** | Two parts of the system disagreed. The enrichment cron's own policy says a 48h-old team cache is acceptable for a fixture more than three days away, but the early lane treated anything over 12h as stale. The result was a rule that early fixtures could almost never satisfy, and that age-only checks could not make safe either. |
| **Frequency** | *Simulated* (`docs/audit/early_freshness_simulation.csv`): with the cron running on time, **6.3%** of early drafts 3–14 days out could pass the old rule; 3.1% when standings refresh every 48h; 0.9–1.4% when the cron runs 24h late. 48–72h drafts: 100% → 3.7% depending on lag. *Production frequency is not measured*; `scripts/audit-early-engine-funnel.ts` reports it (`8c_context_complete` and the `evidence` breakdown per band). |
| **Does `contextComplete=false` mean evidence-free?** | **No.** The flag conflated "stale" with "missing". PR #226's `assessSavedGenerationEvidence` separates `ready` / `needs-freshness-review` / `missing-sporting-evidence` / `no-saved-snapshot` from the saved `AIJob.context`. This change adds per-part provenance (`fresh` / `aged` / `superseded` / `missing`, with fetch time, age and tolerance) to every new job. |
| **Historical vs current data confused?** | Partly. The digest is one projection, so last-season data does not mix in (season resolution is separate, see `currentSeasonDate`). But "verified but old" vs "missing" was not distinguishable before PR #226 and this change. |
| **Reassessed when information changes? New matches before publication?** | **Before:** no. The reassessment worker (`reassessment/worker.ts`) covers PUBLISHED rows only. Early drafts waiting in review/hold were never re-checked against matches played since generation, so they could auto-publish with outdated form. **Integration-test reproduction:** on the pre-fix code, a draft whose away side had played two days after its saved evidence **auto-published** (`scripts/check-early-remediation-postgres.ts` fails on the pre-fix `earlyPublication.ts`). **After:** blocked as `evidence-superseded`, then held (more than 72h out) or sent to admin review. |
| **Unsupported statistics in reasoning?** | Partly guarded. `stripUnsupportedClaims` caught H2H figures, manager names and knockout wording, but not recent-form claims ("won four of their last five"). PR #226 stops the model being called with zero evidence. This change strips form claims contradicted by, or beyond, the saved sample at generation time. The public page's check is deliberately unchanged, so published rows render exactly as before. |
| **Safeguards appropriate for Free/VIP/Premium?** | Free early: 70% floor plus two-sided evidence plus exact fresh quote, which is appropriate. VIP (~75%) and Premium (~80%) are never auto-published by this lane (`reserved-category`, `protected-provenance`). Unchanged. |

---

## 3. Issue 2 — Can the engine generate 4–7 days ahead?

### 3.1 Stage-by-stage assessment

| Stage | 4–7 day capability | Constraint found | Classification |
|---|---|---|---|
| Fixture discovery | Yes: CORE 14d, SECONDARY 10d, FALLBACK 7d, DEEP_FALLBACK 5d | Cursor rotation: 4 scans per pass. Each league is revisited every (pool size ÷ 2) passes. | Legitimate resource control |
| League/cup coverage | CORE+SECONDARY primary; 7 regional spotlight leagues; 1 fallback slot | FALLBACK leagues need cached season metadata or they are skipped (no extra `/leagues` call) | Legitimate (quota) |
| Team identity | Provider ids from the fixture row (no name search) | none | Sound |
| Historical evidence | Team caches exist once the team-enrichment cron reaches queued teams (scope includes PENDING/FAILED attempts) | Standings only for leagues with PUBLISHED predictions, so new leagues had **no standings** | **Defect (fixed: zero-cost rotation)** |
| Freshness | — | Flat 12h floor contradicted the 48h refresh tier | **Defect (fixed)** |
| Odds | Code comment (historical research, `api-football.ts`): quotes exist for 100% of fixtures inside 72h and only 13% beyond 7 days | Lead-time property of bookmakers, not a fault | Legitimate external limit |
| Model assessment | Runs without odds (quote-first, not quote-only) | none | Sound |
| Selection | ≤3 per run, priced first, then **soonest kickoff** | Under a backlog, every fixture is worked at 48–72h, never at 4–7 days | **Design defect (fixed: target-band ordering)** |
| Selective-league gate | Evaluated only from cache, inside the worker | Gated fixtures dropped silently, re-selected every run | **Defect (fixed)** |
| Publication | Needs fresh exact quote | Most 4–7 day fixtures lack quotes; drafts are held and re-triaged every 30 min until odds arrive | Legitimate (quality) |
| Holding / retries | DRAFT hold with revision; re-triaged every cycle; handed to admin at 72h | none | Sound |
| Reassessment near kickoff | Published only | Drafts not reassessed | **Gap (fixed at publication time)** |

**Verdict.** The architecture *can* support 4–7 day assessment: discovery horizons, cache-only generation and recoverable holds are all in place. Before this change it delivered almost nothing in that window, for three code-confirmed reasons: the freshness contradiction, soonest-first ordering under backlog, and head-of-line blocking. Odds remain the binding constraint for *automatic* publication 4–7 days out, and that is correct. Without a bookmaker price the engine now keeps the assessed draft and publishes it automatically once a qualifying quote arrives, if the draft is still valid.

### 3.2 Throughput bounds (code-derived)

| Resource | Bound per day | Source |
|---|---|---|
| Early discovery `/fixtures` calls | ≤ 192 (4 × 48 passes) | crontab + `batch ≤ 4` |
| Early `/odds` calls | ≤ 192 (4 × 48; route allows ≤ 6) | crontab `limit=4` |
| Early model calls | ≤ 144 nominal (3 × 48); in practice ~1–2 per run because the 22s soft deadline is checked before each claim and one model call typically takes seconds to tens of seconds | `worker.ts` `SOFT_DEADLINE_MS` |
| Early triage | ≤ 16 publications per run, all queued rows scanned | `earlyPublication.ts` |

Whether ~50–100 early generations a day keeps up with discovery depends on the production queue depth. That is now reported per band on every run (`queueByBand` in `JobRun.detail` for `early-free-generation`). **No cap was raised:** raising it increases model spend, and the evidence for that decision does not exist yet.

---

## 4. Issue 3 — Why so few automatic publications?

### 4.1 Funnel: gates and their data sources

Production counts for 15–21 Nov are **not measured** (§0). The table states, per stage, the gate the code applies and the field `scripts/audit-early-engine-funnel.ts` reports.

| # | Pipeline stage | Gate in code | Audit field | Main exclusion reasons (code) |
|---|---|---|---|---|
| 1 | Fixtures available from API-Football | Discovery horizon by tier | — (provider) | League not scanned this cycle |
| 2 | Captured | `validFixture` (ids, names, future, horizon) | `1_discovered` | invalid rows |
| 3 | Selected for early processing | `candidatesFromFixtures` (NS, cup scope, non-senior women's sides, selective top-N gate, already generated, ledger backoff) | `2_eligible_queued_early` | selective gate, existing prediction |
| 4 | Excluded by league rules | `isWorthATip`, `fixtureIsInCupScope` | (difference 1→2) | lower-table fixtures in selective leagues |
| 5 | Skipped, existing prediction | `generated.has(key)` | attempt `SUCCEEDED` with other lane | ordinary lane got there first |
| 6 | Rejected, incomplete evidence | PR #226 guard | `5_no_usable_evidence_deferred` | team cache missing |
| 7 | Deferred, cache freshness | **old:** never deferred; frozen as incomplete | `8c_context_complete`, `evidence`, `provenance` | 12h floor (fixed) |
| 8 | Lacking odds | `earlyQuotedSelection` | `6_odds_never_quoted`, blocked `odds-*` | lead time >72h |
| 9 | Fails confidence | `< 70` | `8_confidence_at_or_above_70` | model confidence |
| 10 | Passed to model | worker claim | `3_processed` | soft deadline, lease held |
| 11 | Generated | AIJob + Prediction | `7_early_generated` | — |
| 12 | Pending review | `PENDING_REVIEW` / `EARLY_REVIEW_READY` | `10_admin_review` | 65–69% or price gaps |
| 13 | Held | `EARLY_HOLD` | `11_held_at_least_once` | weak or incomplete, >72h out |
| 14 | Eligible for auto-publication | `earlyPublicationBlock = null` and price ok | JobRun `qualifying` | all gates |
| 15 | Published automatically | `EARLY_PUBLICATION_PRICE` revision | `9_auto_published` | concurrency |
| 16 | Operational failures | JobRun `failures`, `ok=false` | `jobs.*.failed` | DB/timeouts |
| 17 | Never re-attempted | PENDING past kickoff, no prediction in any lane | `13b_lost_no_prediction_any_lane` | — |

### 4.2 Where the losses occur (code-confirmed, ranked)

1. **Evidence freshness contradiction.** This is the single biggest bottleneck. Every early draft generated more than 72h out whose team cache was over 12h old was permanently ineligible. *Simulated:* ≥94% of 3–14-day drafts (old rule pass rate 0.9–6.3%).
2. **Odds lead time.** Exact quotes are rare beyond 7 days and only partial at 3–7 days (historical research cited in `api-football.ts`). Legitimate; drafts now wait in hold rather than being lost.
3. **Soonest-first ordering under backlog.** Fixtures were worked at 48–72h, the band with the least time left for a quote-backed publication.
4. **Head-of-line blocking.** Selective-league fixtures with no cached table occupied run slots indefinitely. Severity grows with the number of spotlight-league fixtures at the head of the queue.
5. **Lease contention.** `early-run` at :09/:39 versus ordinary at :10/:40. An early run still awaiting a model call at the 60-second mark made ordinary generation stand down. *Not measured*; the audit counts `leaseStandDownsByLagosMinute` for `generate-ordinary` (expect a :10/:40 concentration if this occurred).
6. **Odds fetch aim.** Four fetches per half hour were spent without regard to whether a quote could publish anything.

The confidence floor (70) and two-sided evidence rule are legitimate quality rejections and were **not** changed.

### 4.3 Competition with paid and ordinary generation

- The shared lease guarantees no overlap (good), but cron timing decides who stands down. The early run is now at :00/:30, the only minutes with no lease-sharing job within five minutes.
- Early generation spends **no** API-Football quota and is exempt from the quota headroom check. It cannot starve the paid reserve (`PAID_PRIORITY_RESERVE = 300`).
- Early discovery and odds stand down below 2,200 and 1,800 remaining requests respectively, before the paid reserve is reached.
- *Historical (repository, `usage.ts`):* over 14 Oct–13 Nov the paid pass stood down about 130 times because the daily budget was gone (102 times at 0 left), which led to the paid reserve. So the quota **has** been exhausted in recent production.

---

## 5. Architecture review (Part 5)

| Area | Assessment | Action |
|---|---|---|
| League/cup coverage | Broad, rotating, quality-filtered; no arbitrary daily caps | none |
| Team identity mapping | Provider ids end to end; `fixtureApiId` stable across reschedules | none |
| Competition season mapping | `pickSeason` with expiring cache; fallback leagues reuse cached season | none |
| Historical evidence availability | Team scope included queued fixtures; **standings did not** | fixed (rotation, zero extra calls) |
| Cache invalidation | Age-based only | event-based supersession added |
| Request batching/dedup | `/fixtures?ids=` batched for settlement; no cross-job coalescing; Next data cache disabled for correctness | repeat detector added to *measure* duplication first |
| Rate limiting/quota | 250ms throttle, daily gate, paid reserve, early stand-downs | none |
| Model-input quality | Digest shared with match page; PR #226 evidence guard | form-claim check added |
| Confidence calibration | Out of scope for this change; floors unchanged | — |
| Odds/late pricing | Lead-aware bands; publication rechecks exact price atomically | yield-aware ordering |
| Automatic publication eligibility | Strict, atomic, receipted | supersession gate added |
| Admin review flow | Same PENDING_REVIEW queue; holds recoverable | per-part freshness shown |
| Reassessment scheduling | Published rows only | pre-publication check added |
| Retry queue reliability | PR #226 keeps evidence-missing fixtures retrying without exhausting attempts | selective deferral likewise |
| Monitoring/diagnostics | JobRun detail rich; API usage day × path only | hourly × job × outcome telemetry added |
| Cross-job resource allocation | Single lease; cron timing outside the repo (cron-job.org) | early-run re-timed; contention measurable |
| Protection of published selections | Atomic, immutable receipts; no lane edits published rows | unchanged; integration test asserts it |

**Suitability for sustained large-scale early generation.** Suitable after these corrections, with two open limits. (1) Model throughput per run is bounded by the 22s soft deadline, which exists for the cron-job.org 30s wall; the VPS cron calls the app with a 330s client timeout, so this could be relaxed for the VPS-scheduled early run if queue depth shows a backlog (owner decision, it raises model spend). (2) Enrichment-cron lag directly controls evidence freshness; the simulation shows the 3–7-day completeness rate falling from 51–74% (on-time) to 15–33% (24h late). Provenance now makes the actual lag visible per draft.

---

## 6. PR #226 and PR #224 compatibility

- **PR #226** (open): merged into this branch and built on, not duplicated. Its no-evidence guard, 4h uncounted retry and admin banner are retained. One CI assertion it broke (`check-market-sanity`: the admin `aiJob` select now includes `context`) is fixed here, which is likely why #226 shows `unstable`.
- **PR #224** (open, SEO): no file overlap; `git merge-tree` reports a clean merge.

---

## 7. Reconstructing the funnel and usage in production (read-only)

```bash
npx tsx --env-file=.env scripts/audit-early-engine-funnel.ts --from=2026-11-15 --to=2026-11-21 --out=docs/audit
npx tsx --env-file=.env scripts/audit-early-engine-funnel.ts --from=2026-11-22 --to=2026-11-22 --out=docs/audit
npx tsx --env-file=.env scripts/audit-api-football-usage.ts  --from=2026-11-15 --to=2026-11-21 --out=docs/audit [--status]
```

Both scripts only read (`findMany`), never write and never call a billed provider endpoint (`--status` makes one unbilled `/status` request). They output aggregate counts and reason codes only, with no team names, prompts or provider error text.

**What history can and cannot provide:**
- Capture → queue → attempt → draft → hold/review → publication: **fully reconstructable** (UpcomingFixture, GenerationAttempt, AIJob, Prediction, PredictionRevision).
- Why a row was blocked at a given triage pass: **aggregate only** (JobRun.detail.blocked per run, counted once per pass, not per prediction).
- Freshness per evidence part: **only for jobs created after this change** (provenance).
- Hourly / per-job / per-outcome API usage: **only after this change is deployed** (telemetry rows).
