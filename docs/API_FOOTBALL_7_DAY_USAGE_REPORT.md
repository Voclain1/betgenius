# API-Football — Seven-Day Usage Report (15–21 November 2026, WAT)

> **Status: the seven-day production figures could not be collected in this audit.**
> The audit environment had no database credentials, no API-Football key and no egress to the production site (proxy 403). The brief forbids presenting cron-derived estimates as usage, so **every "actual" cell below is marked *not measured*.** This report instead (1) states what the existing telemetry can and cannot prove, (2) gives the exact read-only procedure that fills every table, (3) gives code-derived upper bounds labelled as such, and (4) adds the missing instrumentation so the next audit is fully measurable.

---

## 1. Plan, quota and reset behaviour

| Item | Value | Verified? |
|---|---|---|
| Plan | "Pro" (code comments, `usage.ts`) | **Not verified** (needs `/status` or dashboard) |
| Daily limit used by the app | `API_FOOTBALL_DAILY_LIMIT` env, default **7,500** | Code default verified; production env value **not verified** |
| Per-minute limit | 300/min; app throttles to 240/min (250ms gap, per process) | Code verified |
| Reset | 00:00 **UTC** = 01:00 WAT | Code assumption (`utcDay`); verify on dashboard |
| App reserve | 100 (`API_FOOTBALL_DAILY_RESERVE`) | Code default |
| Paid-only reserve | last 300 requests (`API_FOOTBALL_PAID_RESERVE`) | Code default |
| Early discovery stands down below | 2,200 remaining | Code |
| Early odds stands down below | 1,800 remaining | Code |

The UTC reset means a WAT calendar day straddles **two** quota days (00:00–00:59 WAT belongs to the previous UTC day).

---

## 2. 4A — Daily totals

| Date (WAT) | Provider-counted | Successful | Failed | Rate-limited | Daily limit | % used |
|---|---|---|---|---|---|---|
| Nov 15 | not measured | not measured | not measured | not measured | 7,500 (unverified) | — |
| Nov 16 | not measured | not measured | not measured | not measured | 7,500 (unverified) | — |
| Nov 17 | not measured | not measured | not measured | not measured | 7,500 (unverified) | — |
| Nov 18 | not measured | not measured | not measured | not measured | 7,500 (unverified) | — |
| Nov 19 | not measured | not measured | not measured | not measured | 7,500 (unverified) | — |
| Nov 20 | not measured | not measured | not measured | not measured | 7,500 (unverified) | — |
| Nov 21 | not measured | not measured | not measured | not measured | 7,500 (unverified) | — |
| Nov 22 (partial) | not measured | not measured | not measured | not measured | 7,500 (unverified) | — |

**What exists in production for these days, and what it can fill:**

| Column | Source available for 15–21 Nov | Fillable? |
|---|---|---|
| Provider-counted | API-Football dashboard (owner access) | Yes, from the dashboard only |
| App-counted (dispatched) | `ApiUsage` budget rows, **per UTC day** × path, counted before dispatch (includes failures and 429s); `(reconciled)` rows are upward corrections to the account figure | Yes per **UTC** day (`api_football_usage_*_by_utc_day.csv`). Not per WAT day. |
| Successful / Failed / Rate-limited | Not recorded before this change (failures only in server logs as `[api-football] <status>` / `API error:` lines) | Only from logs, if retained. From deployment on: `#h` telemetry. |
| Total / average / median / peak | derived | From the UTC-day rows |

## 3. 4B — By endpoint

`ApiUsage.path` records each endpoint per UTC day: `/fixtures`, `/teams`, `/teams/statistics`, `/injuries`, `/standings`, `/fixtures/headtohead`, `/odds`, `/leagues`, `/players/*`, `/coachs`, `/fixtures/lineups`, `(reconciled)`. **Seven-day endpoint totals are therefore fillable from production by the script, per UTC day.** Not measured here.

Note: `/fixtures` covers several distinct uses (by date, by league range, by ids, team last-N, live) that share one path key. The new telemetry keeps the path but adds the **job**, which separates them in practice.

## 4. 4C — By job or feature

**Before this change: not attributable.** No request carried a job label. Partial history exists in `JobRun.detail` (`apiCallsSpent` for generation runs, `discoveryCalls`, early-odds `attempted`, early-discovery `scanned`, paid `oddsCalls`). The script sums these as **reported provider calls** per job. This is a lower bound: enrichment, settlement, live scores and page renders do not report call counts.

Code-derived upper bounds for the early lane (not usage):

| Job | Max provider calls/day | Basis |
|---|---|---|
| early-fixture-discovery | ≤ 192 `/fixtures` + season lookups (`/leagues`, ≤ 1 per league per 6h per process) | 4 per pass × 48 |
| early-free-odds | ≤ 192 `/odds` | `limit=4` × 48 |
| early-free-generation | **0** | `withNoFootballApiCalls` (throws before dispatch) |
| early-free-publication | **0** | reads caches only |
| prediction-reassessment | ≤ 3 fixtures per run × 96 runs; each needs a fixture status refresh and possibly odds | `limit=3` |

## 5. 4D — Hourly pattern

**Not measurable for 15–21 Nov** (no hourly data exists). Schedule overlap that the new telemetry will show (WAT = UTC+1; cron-job.org minutes are in WAT, VPS cron minutes in UTC, and the minute values coincide):

| Minute of hour | Jobs touching API-Football |
|---|---|
| :03, :33 | early-discover |
| :05, :20, :35, :50 | VIP/Premium pass (≤12 odds calls/run when due) |
| :06, :36 | early-odds; reassess also at :06/:21/:36/:51 |
| :08, :23, :38, :53 | refresh-insights |
| :10, :25, :40, :55 | ordinary generation (+ discovery, enrichment on cache miss) |
| :15, :45 | European lane |

Quarter-hour concentration is structural: up to four API-consuming jobs start within 6 minutes around :35/:36. The single-process throttle serialises them at 240/min, so concurrency spikes show up as queueing latency, not as 429s, unless another process shares the key.

## 6. 4E — Waste and efficiency

| # | Waste category | Found in code? | Measurable before? | Measurable after deployment |
|---|---|---|---|---|
| 1 | Duplicate requests for the same fixture/team | Possible: ordinary generation refreshes a team on a cache miss while the teams workload may refresh it too; no coalescing | No | `#d` repeat counter (same URL within 10 min, by endpoint × job) |
| 2 | Repeated enrichment | Bounded by tier tolerances | Partly (cache `lastAttemptAt`) | repeats + per-job counts |
| 3 | Repeated requests for unavailable data | Odds: 12h/6h/3h retry backoff; H2H fetched once; failed team refresh retried each cycle | No | `empty` outcome by endpoint × job |
| 4 | Failed requests retrying | Failed odds: 1h backoff (`ODDS_FAILED_RETRY_MS`) | Logs only | `http_error`/`api_error`/`timeout` by hour |
| 5 | Refreshes while cache valid | Leagues workload refreshes stalest regardless of age (no skip) | No | per-job `/standings` counts vs leagues in scope |
| 6 | Calls for fixtures that cannot qualify | Early odds fetched for fixtures whose draft cannot publish | No | `attemptedByYield.review-only` in early-odds JobRun.detail |
| 7 | Excessive odds refreshes | as above | No | as above |
| 8 | Finished/obsolete fixtures | Odds scopes require kickoff in future | n/a | — |
| 9 | Jobs refreshing the same records | teams workload vs generation cache-miss refresh | No | repeats by job |
| 10 | Missing dedup/concurrency protection | Throttle is per process; no request coalescing | — | repeats |

**Definitions used.** *Wasted* means a repeat dispatch of an identical URL within 10 minutes (a candidate; a deliberate retry after failure also counts), or a fetch whose result could not change any decision (e.g. `review-only` odds). An `empty` response is **not** waste: it is a real answer ("no odds yet", "no injuries").

## 7. 4F — Utilisation questions

| Question | Answer from available evidence |
|---|---|
| How much allowance contributes to predictions? | Not measurable for 15–21 Nov. From deployment, `byJobDay` splits generation, enrichment, odds, site and settlement. |
| General site functionality? | Page renders calling the provider are unattributed before; the `site:*` labels cover `/api/fixtures`, `/api/livescores`, `/api/standings`. Server-rendered pages remain `unattributed` (limitation, see below). |
| Paid predictions? | `generate-vip-premium` label, plus `paid-priority` for any unlabelled call inside the paid reserve. |
| Early generation? | Discovery + odds ≤ 384/day by construction; generation 0. |
| Are early predictions sufficiently enriched? | Not before this change for new leagues (no standings) or far fixtures (freshness contradiction). Both fixed without extra calls. |
| Are paid categories starved? | *Historical (repository):* yes, ~130 paid stand-downs on budget exhaustion between 14 Oct and 13 Nov, which led to the 300 paid reserve. Early jobs stand down before that reserve. |
| Exhausting the quota, or leaving capacity unused? | Recently exhausted on some days (historical). 15–21 Nov not measured. |
| Could caching/coalescing/scheduling improve early coverage without more calls? | Yes. Implemented: freshness alignment, standings rotation, yield-ordered odds, lease re-timing (all zero extra calls). Recommended: see the remediation report, §E. |

## 8. Instrumentation added (no schema change)

- **Hourly × endpoint × job × outcome** counters: `ApiUsage` rows with `day = "#hYYYY-MM-DDTHH"` (UTC hour) and `path = "<endpoint>|<job>|<outcome>"`. Outcomes: `ok`, `empty`, `http_error`, `rate_limited`, `api_error`, `timeout`, `network_error`, `quota_refused` (stopped by our own gate, not dispatched).
- **Repeat detector**: `day = "#dYYYY-MM-DDTHH"`, same URL dispatched within 10 minutes by this process (exact on the single-process VPS).
- **Why safe**: budget reads match `day` exactly to `YYYY-MM-DD`, and `#` sorts below every digit, so these rows are excluded from quota sums and from every existing `day >= 'YYYY-MM-DD'` range read (asserted in `check-early-evidence-freshness.ts`). Writes are fire-and-forget and never fail a request. Disable with `API_TELEMETRY=off`.
- **Cost**: one extra upsert per dispatched request; at most about 7,500 per day.
- **Attribution**: 15 route handlers labelled (all `generate/*` lanes including early, reassess, settle, refresh-insights, refresh-enrichment by workload, bet-of-the-day, curate-accumulators, site `/api/fixtures`, `/api/livescores`, `/api/standings`). Anything else is reported as `unattributed`, explicitly rather than hidden.
- **Limitation**: rows are per process memory for repeats only; counters are in the database and survive restarts.
- **Recommended after a week of data**: move telemetry to a dedicated table (requires an approved `db push`).
