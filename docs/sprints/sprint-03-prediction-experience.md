# Sprint 03 — Prediction Experience & Transparency

Presentation-only. Existing published predictions are easier to scan, their
match status is truthful, and a saved prediction that will not be played says
so. Generation, validation, odds, publishing, settlement and the VIP
Reliability workstream are untouched.

## 1. Ownership audit

| Area | Owner | Sprint 03 |
| --- | --- | --- |
| Prediction generation, selection/ranking, VIP/Premium curation | VIP Reliability | not touched |
| Odds collection / validation / refresh, evidence validation | VIP Reliability | not touched |
| Publication eligibility, settlement / grading, cron schedules | VIP Reliability | not touched |
| API-Football enrichment jobs, reliability monitoring | VIP Reliability | not touched |
| Existing ROI widgets, category-page guides | earlier sprints | not touched |
| How a published row is **displayed** (table, score cell, clock, dashboard, saved list) | product | changed |

Open reliability PR #184 (Sprint 08) changes 35 files. Sprint 03 shares exactly
one with it, `package.json`; both add script lines, ours in the middle of the
`check:*` block, theirs at the end, so the merge is textually independent.
Nothing from #184 was merged, cherry-picked or edited. Files deliberately **not**
edited: `PredictionCard.tsx`, `CategoryPredictionsList.tsx`,
`categoryPredictions.ts`, `predictionScope.ts`, `lockedPrediction.ts`, the
homepage / category / match / predictions-index pages, `FeedDayTabs.tsx`.

## 2. UX audit (before → after)

Measured on a real build with a demo day (upcoming, in-play window, awaiting,
settled, postponed and cancelled rows). Screenshots in
`docs/sprints/screenshots/sprint-03/{before,after}/`, metrics in `metrics.json`.

| Finding | Before | After |
| --- | --- | --- |
| A match that kicked off hours ago, with no score, looked identical to an upcoming one | dash in the score cell | "Kicked off" (≤150 min) / "Awaiting result" |
| Postponed / cancelled / abandoned matches | no signal | "Postponed" / "Cancelled" / "Abandoned" / "Suspended" / "Result awarded" |
| Desktop kickoff cell | three-line wrap | two lines: `16:41 WAT` / `Sat 14 Nov` |
| Phone row top line | time only | `Sat 14 Nov 16:41 WAT` |
| Confidence | bare `71%` | same, with "Confidence" for screen readers |
| Saved prediction for a postponed match | listed as upcoming | "Unplayed" state, amber label |
| Dashboard picks | `@ 1.72`; category tag repeated on every Today row | `Odds 1.72`; tag only when it adds information; FT score + WON/LOST/VOID text |
| Touch targets <768px (market chips, Detailed/Compact, name chips) | 24–32px | ≥36px |
| Name follow chip | "Follow" beside a crest, no name | shows the team / competition with +/✓ |
| Saved predictions | reachable only by URL | linked from the account menu and drawer |

Touch targets under 36px on audited pages dropped (home@375 25→21,
today@375 38→34, genius 15→9, banker 9→7, match@375 28→24).

## 3. What changed

- `src/lib/predictionStatus.ts` (new, pure): `rowStatus()` and `clockPhase()`.
  Only provider end-state codes are trusted (FT/AET/PEN, PST/CANC/ABD/AWD/WO/
  SUSP/INT); cached live codes are ignored. Clock-only wording never says
  "Live". A provider end-state beats a stored score.
- `src/lib/matchState.ts` (new): `matchState` extracted from `matchCentre.ts`
  (re-exported there, behaviour identical) so client code imports a few hundred
  bytes, not the match-centre module.
- `LiveScores.tsx` ScoreCell, `PredictionsTable.tsx`, `MatchScoreClock.tsx`:
  status label, kickoff stack, accessible confidence, optional `matchStatus`.
- `personalization.ts`, `personalizationData.ts`, `DashboardParts.tsx`:
  `unplayed` saved state (precedence settled > unplayed > upcoming >
  awaiting) and a single indexed read of Sprint 02's captured result
  (`loadStatusCodes`) — **no provider call**; status is looked up only for rows
  the viewer is entitled to see.
- `MarketChips`, `PredictionViewSwitch`, `BackButton`, `FollowButton`, `Nav`:
  touch targets, named follow chip, saved-predictions link.

Terminology kept as is: Banker of the Day ≠ Bet of the Day; odds ≠ confidence;
published ≠ settled; missing odds or confidence render as absent, never zero.
No new copy uses "AI", and none implies a guaranteed result.

## 4. Deliberate non-changes and limitations

- **Odds on feed cards.** `Prediction.odds` is largely null (generation stores
  `null`), so cards show none. Only existing displays were relabelled "Odds".
  Showing more needs reliability-owned odds work: deferred.
- **Public feeds** get clock-derived status only. Provider PST/CANC reaches the
  dashboard, saved list and match header today; wiring it into the feed rows
  needs the feed loaders (reliability / #184 territory). The `matchStatus` row
  field is the ready hook: set it and the label appears.
- **Homepage ≤375px overflow** is fixed by #184's `flex-wrap` hunk and was
  left alone.
- Global discovery / navigation rebuild belongs to Sprints 04 and 08.
- The market-chip strip is a deliberate horizontal scroller on phones; the
  last chip is partly clipped as the scroll cue.

## 5. Tests

| Check | Tier | Result |
| --- | --- | --- |
| `check-prediction-experience` (status, labels, saved state, boundary) | pure | 119 pass |
| `check-prediction-experience-render` (table, cell, clock, dashboard, locked masking) | render | 60 pass |
| `check-prediction-experience-browser` (Chromium, 320/375/414/768/1440) | render + browser | pass |
| `check-prediction-experience-db` (status lookup, own rows only) | integration | **not run here** (see below) |
| `check-prediction-view` (relative kickoff fixed) | render | 141 pass |
| `tsc --noEmit`, `next build` | | clean |

The pure suite includes a static import deny-list proving none of the new or
edited modules import reliability-owned modules, and a contract test that the
locked-prediction view is unchanged.

Preflight on this branch: 89/94 before the later fixes; the remaining failures
are the same four as on `master` in this environment — `check-house-banners`,
`check-goals-category`, `check-sitemap-scoping`, and `check-db-safety`, which
fails here only because a local `.env` database identity is present (it also
fails on `master` with that `.env`).

The integration check was written and type-checked but not executed: creating
the isolated second database it requires was declined by the environment's
safety classifier. Run `npm run preflight:integration` against a disposable
database before merge.

## 6. Performance

Page-size budgets pass (75 pages). Match page 156.8 / 160 KB (budget 160). Homepage route JS
7.53 → 8.66 kB (+1.1 kB: status label and kickoff stack); shared JS 110.4 / 120 KB.
No new client dependency, no new request, no new API-Football call.

## 7. Premium and privacy

Signed-out, free and VIP viewers were exercised on `/predictions/vip` and the
match page (screenshots `vip-*`, `match-vip-*`); Premium is covered by the
render-tier masking checks, not a browser session. Locked rows still render the
locked view; status is never read for a row the viewer cannot see. No
entitlement, confidence, odds or probability meaning changed.
