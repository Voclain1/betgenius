# Paid predictions sprint 03: reliability, subscriber experience, transparency (13 Nov 2026)

Evidence: production, read-only, `diagnose-generation` runs #38–#39, job
`paid-performance`, step "Production verification…"
(`scripts/verify-paid-production.ts`). The database session is verified
`transaction_read_only = on`. The public probe makes anonymous GET requests to
https://www.betgenius.ng from the GitHub runner. Reproduce with
`npm run verify:paid-production`.

## 1. Verified production status

| Check | Result |
|---|---|
| #176 merged | `05e132b`, 14:48 UTC |
| #176 deployed | `deploy-vps` run 60 succeeded, 14:52 UTC |
| Database compatible | No schema change in #176; the deploy's build runs the schema-sync check |
| Calibration | `cal-20261113-1`, **inactive** |
| Shadow mode / shadow records | **Not yet verifiable.** Shadow records are written by curation, which runs inside the settle job (every 3h), and none ran between the deploy (14:52) and the last check (15:14). Shadow is the code default and no override is visible. The write path is covered by tests. Re-run `npm run verify:paid-production` after the next settle |
| VIP/Premium generation after deploy | PASS: the 15:05 UTC paid-pass run completed ok (no fixture qualified at that time) |
| Subscribers | 3 active paid (2 VIP, 1 Premium). None stored as active past its period. Expiry is resolved at read time (`resolveSubscription`) |
| Locked paid picks extractable? | **Yes, before this PR:** `/api/predictions?category=TODAY` served today's dedicated VIP/Premium picks **unlocked**, reasoning included, to anonymous readers. Fixed here (§5). VIP/PREMIUM feeds, results APIs, match, league and team pages, search and the homepage: no leak found |
| Concurrent work | No open PRs; nothing to coordinate |

## 2. Root causes found (paid lifecycle, last 30 days)

| Stage | Finding | Evidence |
|---|---|---|
| Generation | **A provider billing outage dead-letters fixtures for good.** A fixture gets 3 tries then is ABANDONED. Every provider failing at once fails every fixture identically | 121 abandoned; 112 of them "Every AI provider failed: gemini … prepayment …" |
| Pricing / data budget | **The paid pass is starved of api-football budget.** All consumers share one daily budget, first come first served | Paid pass stood down ~130 times on budget, 102 of them at **0 left** |
| Selection | **Ordinary curation could add a paid tag after kickoff.** `planCuration` never checked kickoff, and it runs every 3 hours over the whole Lagos day, so a pick could enter VIP mid-match, or after full time before settlement, and count in the record | By construction. The new shadow log measures it going forward (0 cases since deploy) |
| Publication lead | Healthy | Dedicated picks published a median 23.9h before kickoff (p10 16.9h); none under 2h; none after kickoff |
| Duplicates / contradictions | None | 0 VIP or Premium fixtures carried twice since the paid-tier cutover |
| Odds | Healthy | 7 fetch errors in 3 days, all "no prices quoted yet" |
| Attempt allocation | Working as #175 intended | Per-kickoff-day attempts recorded |
| Settlement | Paid settlement timely | Median 2.1h after kickoff, max 8h, none over 12h |
| Settlement backlog | Site-wide, not a paid problem | 107 unsettled >6h, 89 need manual settlement; oldest 2022 (seed data) |
| Dry days | Correctly genuine | 2, 6, 9 and 11 Nov classify as LOW_OPPORTUNITY: international break, few paid-scope fixtures, no operational failure |
| Exposure of internals | **The Market-Confirmed badge received the whole stored confirmation**, including #176's internal value assessment (EV), entry fields, calibration version and provider. It is a client component, so these went into subscribers' page payloads | Code; fixed |

## 3. Reliability improvements

1. **Outage-aware failure policy** (`src/lib/generation/failurePolicy.ts`).
   - A provider-wide outage spends no retry; the fixture is retried in 60 minutes.
   - The run stops at the first outage, so one outage costs one call, not one per queued fixture.
   - Ordinary failures keep the 3-strike rule.
   - Bounded: the queue never offers a fixture past kickoff.
2. **Paid priority on the api-football budget** (`src/lib/football/usage.ts`).
   - The paid pass runs inside `withPaidPriority` and may spend the last
     `API_FOOTBALL_PAID_RESERVE` calls (default 300). Everything else stops 300 earlier.
   - Ordinary and Goals generation raise their headroom by the same amount, so
     they stand down cleanly instead of having their calls refused.
   - The paid pass's own headroom is 30 calls (one run needs ≤12 odds calls plus a few context calls).
3. **Kickoff guard.**
   - No pick is newly admitted to a paid feed under 1 hour before kickoff
     (`PAID_MIN_PUBLISH_LEAD_MS`), and no dedicated pick is auto-published under it
     (`TOO_CLOSE_TO_KICKOFF`).
   - Picks already in the feed are never removed, so neither the record nor what
     subscribers saw changes.
4. **Day classifier** (`src/lib/paidOps.ts`). Every Lagos kickoff day is labelled
   one of: OK, LOW_OPPORTUNITY, MISSING_FIXTURES, GENERATION_FAILURE, PRICING_FAILURE
   or PUBLICATION_FAILURE (scheduler gaps included). Failures are checked before
   "low opportunity", so a broken day is never written off as a quiet one.
5. **Idempotency.** Already in place, and kept:
   - publication goes through `applyReviewAction`;
   - the ledger is one upserted row per fixture;
   - one paid pick per fixture;
   - alerts are claimed once per day and cause via an AppLock row before sending.

## 4. Subscriber experience (VIP / Premium, readers with access only)

- **Each card now shows:**
  - status: Upcoming, In play, Awaiting result, Won, Lost, or "Void · stake returned";
  - the price with its provenance — "Price when published" (recorded at
    promotion), "Price now" or "Closing price", each the median and book count,
    and "No bookmaker quote for this market" for draw no bet and team totals;
  - the publication time in WAT;
  - one honest sentence on why the pick is there: both independent reads for a
    dedicated pick, or the tier's published confidence bar for an ordinary one.
- A short intro on the feed says confidence is an estimate, not a guarantee,
  and that the reader's bookmaker's price may differ.
- No EV or calibration figure is shown anywhere, and nothing implies profit.
- Mobile: the details use the card's existing type scale in a 2-column grid
  (3 from `sm`). The market table scrolls horizontally inside its own frame, so
  the page never scrolls sideways.
- Locked readers: unchanged. They get the subscribe cover with no counts, and
  none of the new detail is loaded for them.
- Empty days: the #175 wording, which explains quiet days, still applies.

## 5. Security findings and fixes

| Surface | Finding | Fix |
|---|---|---|
| `/api/predictions?category=TODAY` (and FEATURED, GENIUS…) | **Paid-only picks served unlocked** — the route skipped the paid-only exclusion and gated by the requested feed | Excluded from non-paid feeds as the pages do; access decided per row (`rowViewable`): a paid-only pick needs paid access whatever feed it is requested through; `private, no-store` |
| Market-Confirmed badge payload | Internal EV/calibration/provider fields serialised to subscribers | `badgeConfirmation()` passes only the badge's own fields |
| Track record "recent results" table (public) | Listed settled paid-only picks with their pick text, contradicting members-only paid results (#173) | Pick-level table excludes paid-only picks; month aggregates still count them |
| Homepage hero | Safe, but unprotected by construction | `NOT_PAID_ONLY` added |
| VIP/PREMIUM pages, results API, match/league/team pages, search, sitemaps | No leak (probe and code) | — |
| Expiry and renewal boundaries | Resolved at read time; a lapsed ACTIVE row sees nothing, and a renewed period sees everything again | Regression tests added |

Historical public results not restricted: the monthly track record still counts
every settled pick, VIP included. Only the pick-level detail of paid-only picks
is members-only.

## 6. Performance-reporting methodology (subscriber panel)

The panel shows the record since 3 Oct 2026 (the current paid rules). It counts
settled picks only: pending is never a win or loss. Win rate is won ÷ (won +
lost). A void returns the stake: it is shown, and counts as neither a win nor a
loss nor a stake.

| Price | Source | Shown when |
|---|---|---|
| Recorded entry | Median price frozen on a dedicated pick at publication (from 13 Nov 2026) | ≥30 settled picks have one |
| Closing reference | Median of the last quote before kickoff. A real price, but later than publication, and labelled so | ≥30 settled picks have one |

- The two kinds of price are never mixed.
- Returns are flat one-unit stakes. They are shown whatever their sign; a
  negative return renders as negative.
- Market rows need ≥30 settled picks.
- Derived prices (draw no bet) are never used.
- Definitions match the site's `computeStat`.

## 7. Monitoring and operations

- **`/admin/paid-ops`** (admin only) shows each day's status and reasons, plus:
  fixtures found, covered and failed; paid-scope pricing; attempts and errors;
  promoted and published picks; the longest gap between paid-pass runs; VIP
  and Premium counts; and shadow records. Above the table: the selection mode,
  shadow-log health, the paid pass over the last 24h and the settlement backlog.
- **Alerts:** the settle route (every 3h) emails `PAID_OPS_ALERT_EMAIL`
  through the existing Resend integration. It is opt-in, sends once per day
  and cause, and has no new dependency. Causes: failure statuses for yesterday
  and today, the paid pass silent for 24h, 3+ failed paid runs in 24h, or the
  shadow log silent in shadow mode. Low-opportunity days never alert.
- **Not built:** subscriber-access *error* telemetry. Entitlement denials are
  not logged today, and adding request logging was out of scope; the probe
  covers access correctness.

## 8. Tests

| Suite | Result |
|---|---|
| `check-paid-subscriber` (new) | 87/87 |
| `check-paid-render` (new, server-rendered HTML) | 21/21 |
| `check-paid-selection`, `check-paid-value-integration`, `check-vip-premium-overlay` | 75 / 55 / 228, all pass |
| `check-adaptive-coverage`, `check-european-clubs`, `check-generation`, `check-track-record`, `check-vip-premium-quota`, `check-paid-tier-grace`, `check-banker-curation` | all pass |
| `tsc --noEmit` | clean |
| Preflight | 84/87. One regression of mine (`check-seo` pins the feed `intro` literal) was found and fixed. The remaining 3 are the master baseline failures |

Baseline failures, the same on `master` and unrelated: `check-house-banners`,
`check-goals-category`, `check-sitemap-scoping`. The repo has no ESLint config.

## 9. Deployment

- No schema change, migration or new secret.
- Optional settings:
  - `PAID_OPS_ALERT_EMAIL` to receive alerts;
  - `API_FOOTBALL_PAID_RESERVE` to tune the reserve (default 300).
- After deploying, run `npm run verify:paid-production` (or dispatch
  `diagnose-generation`) and expect ALL CHECKS PASSED.

## 10. Rollback

- Revert the squash commit. Nothing to clean up.
- Alert claims are AppLock rows that expire after 14 days.
- No historical row was rewritten.
- `API_FOOTBALL_PAID_RESERVE=1` effectively removes the reserve without a revert.

## 11. Remaining risks and next steps

- The Today-feed leak was live until this PR deploys. Whether anyone used it
  is unknown, because request logs are not kept here. **Merge and deploy this PR first.**
- The 300-call reserve lowers ordinary generation's effective daily ceiling by
  300 calls (of 7,500).
- The kickoff guard means a pick generated inside the last hour never enters
  VIP. That's intended, but it slightly lowers same-day volume.
- The entry-price return needs about 30 settled dedicated picks with recorded
  prices: roughly 2–3 weeks at the current rate.
- Gemini credit exhaustion caused the outage. The fallback chain now keeps
  fixtures alive, but provider billing is a single point of failure the owner
  should monitor.
