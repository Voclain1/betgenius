# API-Football — Seven-Day Usage Report (15–21 November 2026)

**Sources (verified).** Read-only exports from the production PostgreSQL database on Contabo, supplied by the owner on 22 Nov 2026 and committed unchanged:
- [`audit/api_usage_utc_2026-11-14_to_21.csv`](audit/api_usage_utc_2026-11-14_to_21.csv): the `ApiUsage` budget counters per UTC day × endpoint;
- [`audit/job_runs_wat_2026-11-15_to_21.csv`](audit/job_runs_wat_2026-11-15_to_21.csv): `JobRun` grouped per WAT day × job.

Every figure below was recomputed from those files; all of the owner's headline figures reproduce exactly.

**What these numbers are.** App-counted requests: `recordCall` increments before each request is dispatched, so failures, timeouts and 429s are included. They are **not** provider-billed counts. There is no `(reconciled)` row in the window, so the app was never corrected against the account's `/status`. Its absence does not prove the two match.

**What they cannot show (and this report does not invent).** WAT-day totals (the counters are UTC days), hourly distribution, success/failure/429 split, per-job request attribution, repeat requests and cache-hit rates. PR #227's telemetry records all of these from deployment on.

---

## 1. Plan, quota and the order in which jobs stop

| Item | Value | Status |
|---|---|---|
| Daily limit | 7,500 (code default `API_FOOTBALL_DAILY_LIMIT`) | production env value **not verified** |
| Reset | 00:00 UTC = 01:00 WAT | code |
| `remaining` used by every job | 7,500 − 100 reserve − used = **7,400 − used** | code (`getUsageSnapshot`) |
| Non-paid hard ceiling | 7,500 − 100 − 300 paid reserve = **7,100 used** | code (`budgetCeiling`) |

Each job stands down at its own `remaining` threshold. Translated into "used" and checked against the verified daily totals:

| Job | Stands down below `remaining` | i.e. once used exceeds | Days reached (of 7) |
|---|---|---|---|
| Early discovery (**before** this PR) | 2,200 | 5,200 | **7** |
| Early odds warming (**before**) | 1,800 | 5,600 | **7** |
| European lane, top matches, recent results | 1,500 | 5,900 | 7 |
| Evaluation lane | 2,000 | 5,400 | 7 |
| **Live scores stop filling** | 1,000 | 6,400 | 7 (lowest day 6,421) |
| Early lane (**after** this PR) | 750 | 6,650 | **3** (15, 20, 21 Nov) |
| Ordinary generation | 500 | 6,900 | 2 (20, 21 Nov) |
| Non-paid hard ceiling | 300 | 7,100 | **2** (7,124 and 7,125) |
| VIP/Premium pass | 30 | 7,370 | 0 |

---

## 2. 4A — Daily totals (UTC days)

| UTC day | App-counted | Successful | Failed | Rate-limited | Limit | % of limit | Headroom to 7,100 non-paid ceiling |
|---|---:|---|---|---|---:|---:|---:|
| Nov 15 | 6,908 | not recorded | not recorded | not recorded | 7,500 | 92.1% | 192 |
| Nov 16 | 6,544 | not recorded | not recorded | not recorded | 7,500 | 87.3% | 556 |
| Nov 17 | 6,501 | not recorded | not recorded | not recorded | 7,500 | 86.7% | 599 |
| Nov 18 | 6,421 | not recorded | not recorded | not recorded | 7,500 | 85.6% | 679 |
| Nov 19 | 6,639 | not recorded | not recorded | not recorded | 7,500 | 88.5% | 461 |
| Nov 20 | 7,124 | not recorded | not recorded | not recorded | 7,500 | 95.0% | **−24** |
| Nov 21 | 7,125 | not recorded | not recorded | not recorded | 7,500 | 95.0% | **−25** |
| Nov 22 (partial) | not supplied | | | | | | |

Seven days: **47,262** requests. Average **6,751.7**/day, median **6,639**, peak **7,125** (Nov 21), minimum 6,421 (Nov 18). Nov 14 (boundary context): 6,801.

On Nov 20 and 21 the day went **past the non-paid ceiling**. Every non-paid caller was refused for the rest of those UTC days, and the last 24–25 requests could only have come from paid-priority calls. Success, failure and 429 counts were never recorded before PR #227.

## 3. 4B — By endpoint

| Endpoint | 11-15 | 11-16 | 11-17 | 11-18 | 11-19 | 11-20 | 11-21 | 7-day | Share |
|---|---|---|---|---|---|---|---|---|---|
| `/fixtures` | 4,371 | 4,218 | 3,923 | 4,124 | 3,807 | 4,060 | 4,178 | 28,681 | 60.7% |
| `/odds` | 564 | 523 | 599 | 399 | 557 | 790 | 1,224 | 4,656 | 9.9% |
| `/leagues` | 393 | 360 | 350 | 316 | 415 | 368 | 282 | 2,484 | 5.3% |
| `/fixtures/headtohead` | 209 | 200 | 205 | 227 | 262 | 223 | 155 | 1,481 | 3.1% |
| `/teams` | 149 | 111 | 153 | 150 | 236 | 261 | 236 | 1,296 | 2.7% |
| `/injuries` | 147 | 111 | 151 | 150 | 234 | 257 | 232 | 1,282 | 2.7% |
| `/teams/statistics` | 147 | 111 | 151 | 150 | 234 | 257 | 232 | 1,282 | 2.7% |
| `/coachs` | 144 | 168 | 154 | 158 | 139 | 102 | 73 | 938 | 2.0% |
| `/players/squads` | 144 | 168 | 154 | 158 | 139 | 102 | 73 | 938 | 2.0% |
| `/standings` | 130 | 125 | 129 | 127 | 126 | 113 | 73 | 823 | 1.7% |
| `/players/topassists` | 108 | 112 | 109 | 114 | 115 | 98 | 74 | 730 | 1.5% |
| `/players/topscorers` | 108 | 112 | 109 | 114 | 115 | 98 | 74 | 730 | 1.5% |
| `/players/topyellowcards` | 108 | 112 | 109 | 114 | 115 | 98 | 74 | 730 | 1.5% |
| `/fixtures/lineups` | 94 | 69 | 125 | 56 | 48 | 164 | 70 | 626 | 1.3% |
| `/players` | 92 | 44 | 80 | 64 | 97 | 133 | 75 | 585 | 1.2% |
| **Total** | **6,908** | **6,544** | **6,501** | **6,421** | **6,639** | **7,124** | **7,125** | **47,262** | 100% |

**Equal pairs are explained by code, not waste.** These identities hold on every day:
- `/injuries` = `/teams/statistics`: both are issued by one `getTeamContext` per team refresh, together with one `/fixtures?team&last=5`.
- `/coachs` = `/players/squads`: one squads refresh issues both.
- The three `/players/top*` leaderboards: one league player-stats refresh issues all three.

This pins two `/fixtures` sources exactly: team enrichment's recent-matches fetch is **1,282** (183/day), and league enrichment's range fetch is at least **823** (≈ `/standings`; cups without standings add a few).

## 4. 4C — By job

**Per-job request counts are not in the history and are not estimated here.** What the exports do show is how often each job ran and how often its summary mentions quota or budget. That keyword count was reconciled against the code's actual stand-down strings:

| Job (Nov 15–21 WAT) | Runs | Quota/budget summaries | What the keyword actually means (code) |
|---|---:|---:|---|
| `generate-european-clubs` | 336 | 64 (19.0%) | "api-football quota headroom too low": the lane needs 1,500 remaining (used > 5,900). Real API stand-downs. |
| `early-fixture-discovery` | 123 | 44 (35.8%) | "stood down to protect API quota": needed 2,200 remaining (used > 5,200). Real API stand-downs. Nov 20: 16/48, Nov 21: 28/48. |
| `early-free-generation` | 118 | 17 (14.4%) | "Early generation deferred for quota": a gate requiring 1,800 remaining, on a job that makes **0** API-Football calls. Removed by PR #218 (21 Nov 11:36 WAT); 15 on Nov 20, 2 on Nov 21. |
| `generate-vip-premium` | 672 | 8 (1.2%) | All on Nov 15. **Not API budget:** the paid pass stops for API budget only below 30 remaining (used > 7,370), which no day reached. Its summaries say "daily VIP/PREMIUM generation quota already spent", the 8-attempts-per-kickoff-day **paid attempt** quota. |
| `generate-ordinary` | 924 | 3 (0.3%) | "api-football daily budget nearly exhausted": below 500 remaining (used > 6,900). Nov 20 only (that UTC day reached 7,124). |
| `early-free-odds` | 56 | 0 | **Under-counted:** a quota stand-down returned an empty summary with no keyword. Fixed in this PR, which now names it. |

18,700 runs, 0 with `ok=false`. A deliberate stand-down is `ok=true` by design, so zero failures does not mean zero operational impact.

## 5. 4D — Hourly pattern

**Not recorded historically.** No hourly figures are given.

Structurally, the live-score snapshot (§6.1) paces its calls at max(15 s, secondsLeftInUtcDay ÷ (remaining − 1,000)). Early in each UTC day that is the 15-second floor, i.e. **240 calls/hour while anyone is reading live scores**, slowing as the day's quota runs down. From deployment of PR #227, `#h` telemetry gives exact hourly counts by endpoint, job and outcome, and live scores are labelled `site:live-snapshot`.

## 6. 4E — Where the allowance goes, and waste

### 6.1 `/fixtures` (60.7%): the live-score snapshot is a quota filler

`src/lib/liveSnapshot.ts` refreshes `/fixtures?live=all` site-wide whenever a reader (Livescores page, match pages, the homepage strip, browsers polling `/api/livescores` every 15 s) finds the shared copy expired. Its interval is:

```
max(15 s, secondsLeftInUtcDay / (remaining − 1,000))
```

So it is designed to spend **all quota above 1,000 remaining**, evenly over the rest of the day, down to a 15-second floor (≤ 5,760 calls/day). Its target end-of-day level is 7,400 − 1,000 = **6,400 used**. The verified data fits that design:
- the lowest day is **6,421**, 0.3% above the filler's target;
- on Nov 15–19, `/fixtures` moved opposite to every other endpoint (r = −0.64): when other jobs spent more, `/fixtures` spent less, keeping totals within 6,421–6,908. This is consistent with a filler (n = 5, supporting evidence rather than proof);
- `/fixtures` varied by only ±174/day, against ±278/day for everything else.

**Bound.** Live scores used at most **3,797/day**: 4,097 `/fixtures`/day minus the 183 (team enrichment) and 118 (league enrichment) pinned above. The other `/fixtures` callers (generation discovery, early discovery, insights, top matches ≤300/day cap, recent results ≤200/day cap, fixture details, settlement, European lane, reassessment ≤96/day) all come out of that same 3,797, so live scores' true share is lower. The split is not in the history; telemetry measures it within a day of deployment.

**Consequence that matters most.** Because live scores absorb everything above 1,000, **an API saving anywhere else is re-spent on live-score refreshes, not freed for prediction work**, unless the allocation changes. And because early discovery's 2,200 threshold sat above that 1,000 floor, the early lane was the first thing shut out every day.

### 6.2 `/odds` (9.9%): the 20–21 Nov rise

| | Nov 15–19 mean | Nov 20 | Nov 21 |
|---|---:|---:|---:|
| `/odds` | 528.4 | 790 (+262) | 1,224 (+696) |
| Max possible from early odds warming (runs × 4) | 0 | 32 (8 runs) | 192 (48 runs) |
| **At least this much from other sources** | — | **+230** | **+504** |

So at least 72–88% of the increase is **not** the early lane. The leading code-confirmed candidate is **PR #217 (merged 20 Nov 18:35 UTC)**. It extended `checksMarket` to Goals generation, so the Goals pass (96 runs/day) now calls `loadFixtureOdds`, which fetches odds once for any fixture not yet priced and retries every 6 h while it stays unpriced. More published picks inside 72 h of kickoff (published-pick odds refresh hourly near kickoff) and a busy Saturday may also contribute. The previous Saturday, Nov 15, had 564, so the weekend alone does not explain it. **The split cannot be proven from history.**
- `scripts/audit-api-football-usage.ts` now reports distinct fixtures last priced per day, split into early-queued / Goals pick / published (a lower bound from `FixtureOddsCache`).
- PR #227's telemetry splits `/odds` by job (`generate-goals`, `early-free-odds`, `enrichment:odds`, `generate-vip-premium`, `generate-ordinary`) from the first day.

### 6.3 Other measurable inefficiencies

| Endpoint | Verified | Why (code) | Waste? |
|---|---|---|---|
| `/leagues` | 2,484 (355/day, 5.3%) | `resolveSeason` re-reads each league's season list every 6 h (in-process cache), about 89 leagues × 4/day. Season lists change about once a year. | **Yes, avoidable.** Fixed in this PR (see §8). |
| `/players/top*` | 2,190 (313/day, 4.6%) | League leaderboards refreshed every 12 h for top/mid leagues | Partly: leaderboards change once per matchday |
| team recent matches (two jobs) | 183/day (enrichment, `last=5`) plus insights (`last=20`, every 6 h per team with a published pick in 7 days) | Two independent fetches of the same team history | Partly duplicate; insights already has an event trigger but also refetches every 6 h by age |
| `/fixtures/headtohead` | 1,481 (212/day) | Fetched once per new pair, then only after a newer meeting | Efficient |
| `/coachs` + `/players/squads` | 1,876 (268/day) | Weekly squad TTL | Efficient |

## 7. 4F — Utilisation answers

| Question | Answer (verified unless marked) |
|---|---|
| Exhausting the quota or leaving capacity unused? | **Near exhaustion every day, by design.** 85.6–95.0% of 7,500; the 7,100 non-paid ceiling was exceeded on Nov 20–21. The headroom that exists is converted into live-score refreshes. |
| Are paid categories starved? | **Not of API budget in this window.** No day reached the paid pass's 7,370 stand-down. Its 8 quota summaries are its own attempt quota. The 300 paid reserve held. |
| Is the early engine starved? | **Yes, of discovery and odds** (§4): 44 of 123 discovery passes stood down, and odds stand-downs were silent. Early **generation** stood down 17 times only because of a gate on a zero-call job (removed by #218). **Publication** makes no provider calls. |
| How much goes to site functionality vs predictions? | Not attributable historically. Bound: live scores ≤ 3,797/day (≤ 56% of the daily average). Measured exactly from deployment of PR #227. |
| Could caching/scheduling improve early coverage without more calls? | Yes, but only if the live-score filler stops absorbing savings. See the remediation report §R3. |

## 8. Changes made in response (PR #227)

- **Early-lane threshold 2,200/1,800 → 750** (shared). It now sits below live scores' 1,000 floor, so live scores stop first. Order: live (1,000) → early (750) → ordinary (500) → paid (30). Replay on the verified totals: the early lane would have been shut out on 3 of 7 days (late, after 6,650 used) instead of 7 of 7 (after 5,200).
- **Season-list TTL 6 h → 48 h**, but kept at 6 h within 21 days of any season start or end, or when every listed season has ended. *Estimate:* saves 150–270 of the 355 `/leagues` calls/day. The range depends on the share of leagues near a boundary in late November (calendar-year leagues finishing); the `/leagues` counter measures it.
- **Early odds stand-downs named** in the job summary.
- **Attribution** inside the live-score, top-matches and recent-results fetchers, so homepage server renders are no longer `unattributed`.
- **Hourly × endpoint × job × outcome telemetry** (from the first round). Benchmarked locally at about 0.23 ms per write, about 1.4k rows per full 7,500-request day, no lost increments.
