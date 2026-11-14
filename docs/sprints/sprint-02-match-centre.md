# Sprint 02 — Match Centre and football statistics

Status: implemented on branch `ccr-666ad6e8-0rzntk`, not merged, not deployed.
**No database schema change** and no new environment variables or secrets.

Builds on Sprint 01 (`b693019`, merged as #174): favourites, saved
predictions and the user's timezone are reused, not re-implemented.

## 1. Audit — what existed

The canonical match page (`/predictions/match/[slug]`) was already a deep,
cache-only page: no API-Football call happens on a page view. Everything below
is read from cron-filled tables.

| Area | Found | Status |
|---|---|---|
| Masthead | Crests, competition, kickoff (WAT), venue/round/referee facts, follow team/match | Present; extended |
| Live score | `MatchScoreClock` polls `/api/livescores` only while the match is in play | Present; kept. Irregular status only appeared after a client fetch |
| Verdict / preview / key factors | Published-prediction driven, premium-masked, evidence-cleaned | Present; untouched |
| Recent form | `MatchRecentResults` — last 5 from the prediction's original evidence | Present; kept |
| Team fixture history | `TeamFixtureHistory`: last 20 fixtures per team (provider id, date, status, competition, regulation score), refreshed every 6 h for teams in published predictions kicking off within the refresh horizon (`insightRefresh.ts`) | **Present but underused** — only Match Insights read it |
| Verification rules | `verifiedHistory()` in `insights.ts`: dedupe by fixture id, cut at kickoff, friendlies excluded, unplayed skipped, sample ends at an unverified or awarded result | Present; reused as the single source filter |
| Venue statistics | `MatchStatsComparison` (season stats + last-5 rates, % only) | Present; kept |
| Standings | `LeagueEnrichmentCache.standingsJson` incl. home/away splits and zone labels; panel showed #/P/GD/Pts only | **Underused**; extended |
| H2H | `H2HCache` up to 10 meetings; panel showed all-time W-D-W + 5 meetings | Present; windowed with counts |
| Odds | `FixtureOddsCache`, `MatchOddsPanel` with stale gating, archived quotes, named bookmakers, "not a probability" note | Present and correct; reused unchanged (Sprint 05 extends it) |
| Match result | Final score only, from settled prediction rows | **Missing**: half-time, events, statistics, irregular states |
| Events/statistics | Not stored anywhere | **Missing** |
| Premium masking | Server-side per row (`canViewCategory`) | Present; one leak fixed (§7) |
| SEO | `matchTitle`/`matchDescription`, `SportsEvent` JSON-LD with `eventStatus`, evidence-gated indexing | Present; status fallback added |
| Sprint 01 | Save buttons on cards, follow team/match | Present; follow competition + user timezone added |
| Migrations | `prisma db push` via the `db-push` workflow | Not needed this sprint |

## 2. What was built

1. **Form & goals** (`#form-goals`, new): both teams side by side with
   - **window** Last 5 / Last 10, and **scope** All competitions / Home-Away
     (home team's home matches vs away team's away matches) / This competition;
   - per team: sample size, date range, scope in words, a compact W/D/L tile
     strip (score under each letter, full screen-reader text), and a
     "Source matches" disclosure listing every match used (date, opponent,
     venue, score, competition);
   - comparison table: W-D-L, scored/conceded per match, clean sheets, failed
     to score, both teams scored, Over 0.5/1.5/2.5/3.5 — each rate as
     `70% 7/10`, with horizontal bars that are decorative (`aria-hidden`).
2. **Head-to-head** (extended): Last 5 / Last 10 windows; wins/draws per
   today's side, goals per side and per meeting, BTTS and Over 2.5 with
   counts, today's home side's record as host and as visitor, meetings with
   date and competition.
3. **Table context** (extended): W, D, L, GF:GA columns (≥640 px), a
   points-and-places sentence (arithmetic only), each team's record at
   today's venue from the table splits, season named, grouped tables handled.
4. **Result** (`#result`, new) for finished and irregular fixtures: FT and HT
   score, AET/penalties label, goals/penalties/own goals/red cards with
   minutes, scorers and assists, bookings and substitutions behind a
   disclosure, match statistics as split bars, and how each **visible**
   published pick settled. Postponed / cancelled / abandoned / awarded /
   suspended fixtures get a plain statement and never a score.
5. **Masthead**: server-rendered status (postponed/cancelled on first paint),
   half-time score, season, and **"Your time"** for signed-in readers whose
   Sprint 01 timezone is not WAT; **follow competition** button.
6. **Coverage line** under the section nav naming any section that cannot be
   shown and why (repeated with reasons in "About this data").
7. **Zero-quota result capture** (`fixtureResultCapture.ts`, §5).
8. Section nav entries now mirror exactly what renders.

## 3. Statistics and formulas

All in `src/lib/matchCentre.ts` (pure, unit-tested).

**Source matches** (`formMatches`): `verifiedHistory()` → matches of this team,
kicked off **before this fixture's kickoff** (so a finished match's own result
is never part of its "form"), status FT/AET/PEN, regulation-time score,
friendlies excluded, de-duplicated by provider fixture id, newest first; the
sample **ends** at a completed-but-unscored or awarded match (never joins two
non-consecutive runs); postponed/cancelled skipped. Scope:
`ALL`, `VENUE` (home side → its home matches, away side → its away matches),
`COMPETITION` (this fixture's league id). Window: first 5 or 10.

For a sample of `d` matches with own goals `f` and against `a`:

| Figure | Formula |
|---|---|
| W / D / L | `f>a` / `f=a` / `f<a` (regulation time; a penalty shoot-out is a draw) |
| Scored per match | `Σf / d` (2 dp) |
| Conceded per match | `Σa / d` |
| Clean sheets | `#(a=0)` of `d` |
| Failed to score | `#(f=0)` of `d` |
| Both teams scored | `#(f>0 ∧ a>0)` of `d` |
| Over N.5 | `#(f+a > N.5)` of `d`, N ∈ {0,1,2,3} |
| Points per game | `(3W + D) / d` |
| W-D-L bar | share of points available: `(3W + D) / 3d` |
| Average bars | value ÷ max(1, home, away) |

`d = 0` → every rate/average is `null` and printed as "—", never 0%.

**H2H** (`h2hWindow`): meetings involving exactly these two teams, valid
non-negative scores, kicked off before this fixture, de-duplicated by fixture
id, newest first, first 5 or 10. Wins/goals are from **today's** sides'
perspective wherever the meeting was played; BTTS = both > 0; Over 2.5 = total
> 2.5.

**Table** (`tableContext`): both teams must be in the cached table of **this
fixture's competition**; otherwise nothing is shown (never a table from
another competition, never half a table). Duplicate ranks ⇒ grouped table ⇒
only the two teams, no "places apart". Points gap and places are arithmetic;
qualification/relegation meaning is never inferred (zone labels are the
provider's own).

**Match state** (`matchState`): a provider status code decides (PST →
postponed even if a score is stored; ABD/AWD/CANC/SUSP/INT likewise); without
one, a settled score ⇒ finished, a future kickoff ⇒ scheduled, otherwise
"unknown" (never guessed as live).

**Not computed** (insufficient source data, by design): first/second-half
trends (history stores no half-time scores), player statistics from scores,
probabilities of any kind. Every rate is labelled a historical observation.

## 4. Data sources and caching

| Panel | Source | Freshness |
|---|---|---|
| Form & goals | `TeamFixtureHistory` (20/team) | refreshed ≤ 6 h for upcoming published fixtures |
| H2H | `H2HCache` (≤ 10 meetings) | existing H2H refresh |
| Table | `LeagueEnrichmentCache` (this league) | existing enrichment refresh; season shown |
| Result / status | `FixtureDetailCache.detailJson.result` | captured by settlement (every 10 min), kickoff reconcile, fixture-detail refresh |
| Odds | `FixtureOddsCache` | unchanged; stale quotes withheld |

The page remains `force`-dynamic as before (it reads the session for premium
gating). Public statistics are computed per request in memory from ≤ 20 rows
per team (no extra queries beyond those the page already ran). Nothing
user-specific is cached; the only new per-user read is the Sprint 01
timezone, for signed-in readers only.

**Payload:** the browser receives each team's verified matches **once** (≤ 10
per scope) and derives the 5-match view as a prefix with the same pure
function (`summarizeForm`), rather than receiving 12 precomputed summaries;
H2H likewise sends ≤ 10 meetings once. A test asserts the derived figures are
identical to the full server computation.

## 5. API-Football quota

**Zero new calls.** `captureFixtureResults` stores the result record from
responses the app already fetches:

- settlement's batched `/fixtures?ids=` (≤ 20 per call) — status, HT/FT/ET/pens,
  and events/statistics **when the response carries them**;
- kickoff reconciliation's batched `/fixtures?ids=` — catches postponements
  before kickoff;
- the fixture-detail refresh's per-day `/fixtures?date=` slate — status and scores.

Records are keyed by **provider fixture id** (a rescheduled fixture cannot
inherit another game's result), merged so a slimmer later response never
erases stored events, and the capture never throws into its caller.

## 6. Personalization (Sprint 01)

Reused, semantics unchanged: kickoff "Your time" and all Match Centre dates in
the reader's saved timezone; follow team / **competition** / match through the
existing `UserFollow` + `FollowButton`; save buttons on every visible pick
(`SavePredictionButton`). Verified end to end: following the competition from
the match page persists a LEAGUE follow; saving a pick from the match page
lists it on `/dashboard/saved`.

## 7. Security and premium access

- Locked rows on the match page now carry **no outcome** (and no over/under
  line): a padlocked card previously showed WON/LOST, revealing a paid pick's
  result. Same rule as the VIP/Premium feeds (#173).
- The result panel grades only picks the reader can see; locked picks are
  counted, never graded.
- Verified against the rendered HTML: an anonymous reader's page contains
  neither the VIP pick's odds nor its confidence; a VIP reader sees and gets
  all picks graded.
- Data sent to client components is public historical football data only.
- No provider credential or call is reachable from the page.

## 8. SEO

Canonical URLs, titles, descriptions and evidence-gated indexing are unchanged.
`SportsEvent.eventStatus` now falls back to the captured provider status, so a
postponed or cancelled fixture is marked `EventPostponed`/`EventCancelled`
even when the ingested Fixture row has no status. New panels add original,
verified, match-specific content (sample-stated statistics, result record).
No public copy uses "AI" wording or certainty language (asserted).

## 9. Tests

| Suite | Result |
|---|---|
| `check-match-centre.ts` (pure; in preflight) | **101 passed, 0 failed** |
| `check-match-centre-render.tsx` (rendered HTML; in preflight) | **77 passed, 0 failed** |
| `check-match-centre-db.ts` (integration tier, disposable Postgres 16) | **9 passed, 0 failed** |
| `check-personalization-db.ts` (Sprint 01 regression) | **65 passed, 0 failed** |
| Existing match/SEO/premium checks (`check-match-render`, `check-match-insights-render`, `check-prediction-view`, `check-seo`, `check-vip-premium-overlay`, `check-match-evidence`, `check-match-lineups-odds`, `check-competition-stage`, `check-insights`, `check-results-pass`) | all pass |
| `tsc --noEmit`, `npm run build` (incl. schema-sync) | pass |
| `check:budgets` | all pages within budget; match page 157.3 / 160 KB |
| `npm run preflight` (pure tier, no `.env`) | current `master` (b693019) **80/83**; this branch **82/85** (the 2 extra steps are this sprint's, passing). The same 3 baseline failures with **byte-identical failure lines** on both: `check-house-banners`, `check-goals-category`, `check-sitemap-scoping` — none touched here |

Covered: provider-id dedupe, competition/season mapping, form/H2H/goals/
BTTS/over-under/home-away calculations, short and empty samples, friendlies,
postponed/awarded/unverified fixtures, cutoff at kickoff, standings (missing
team, grouped, not started, no splits), every match state, event/statistics
parsing and orientation, capture merge and id isolation, premium masking,
Sprint 01 follow/save, reader timezone, payload equivalence, public copy and
design rules.

Browser (Playwright, production build, local DB): toggles change figures and
samples; no horizontal overflow at 320/375/414 px and on iPhone 13; anonymous
HTML free of the VIP pick; locked card shows no outcome; postponed labelled;
sparse page names what is missing; FREE save → `/dashboard/saved`; VIP sees all
picks graded; follow competition persists.

## 10. Performance (measured, same database, production builds)

Median / p90 time to first byte over 30 requests after warm-up, and gzipped HTML:

| Page | master | this branch |
|---|---|---|
| Scheduled, full data | 38 / 44 ms · 21.7 KB | 46 / 55 ms · 26.4 KB |
| Completed, full data | 34 / 41 ms · 21.3 KB | 44 / 50 ms · 28.4 KB |
| Sparse (no caches) | 30 / 36 ms · 18.7 KB | 33 / 36 ms · 20.2 KB |

First-load JS for the route: 127 → 132 kB (route chunk 3.8 → 8.4 kB), within
the 160 KB budget. The added HTML is the new panels' content; duplicated
window payloads were removed (≈ 1.4 KB gzipped saved). No polling was added.

## 11. Screenshots

`docs/sprints/screenshots/sprint-02/` — real production-build screenshots
against a local database **seeded with demonstration data** (real
API-Football team ids; fixtures, scores, events and odds are invented for the
demo). Crest images cannot load in the sandbox and show as broken images
there; production loads them.

01/02 scheduled desktop/mobile · 03 form & goals (desktop, last-10 + venue,
mobile) · 04 H2H · 05 standings · 06 completed result (desktop, full page,
mobile) · 07 postponed · 08 missing data · 09 premium-locked · 10 masthead with
"Your time" and follow controls.

## 12. Known limitations

- **Events and match statistics** appear only if the provider's `?ids=`
  response carries them. API-Football documents that id lookups include
  events/statistics, but this could not be confirmed from the sandbox (no API
  access). If it does not, the result panel shows scores and says events are
  unavailable. Verify on the first settled match after deploy.
- **Matches settled before this deploy** have no captured record (settlement
  does not re-fetch them): their pages show the settled score and no events.
- Fixture history exists only for teams that had a published fixture inside
  the refresh horizon; others show the coverage line instead of statistics.
- Form for a completed fixture uses the history as cached now, restricted to
  matches before kickoff; if the cache has rolled past older matches the
  sample can be shorter than at kickoff (the real sample is always shown).
- No half-time or player-level trends (not in the source data).
- Live updates remain the existing in-play polling; no new real-time claims.

## 13. Deployment

1. Merge and deploy as usual. **No `db-push` is needed** — no schema change
   (`FixtureDetailCache.detailJson` is an existing JSON column).
2. No environment variables, secrets or cron changes. Records begin to fill as
   the existing settlement (every 10 min), kickoff reconcile and
   fixture-detail jobs run.
3. After the first settled fixture post-deploy, open its match page and
   confirm whether events/statistics were captured (§12).

Rollback: revert the code. Stored `detailJson.result` keys are ignored by the
previous version.

## 14. Foundations for later sprints

- `matchCentre.ts` contracts (`FormMatch`, `FormSummary`, `Rate`,
  `H2HWindowStats`, `TableContext`, `FixtureResult`, `MatchEvent`) are reusable
  by research tools (S12), the performance dashboard (S09) and notifications
  (S06 — e.g. a postponement is now a stored, typed state).
- `formatRate` / n-of-d convention is the house format for any historical rate.
- `MatchOddsPanel` + `FixtureOddsCache` are untouched for Sprint 05.
