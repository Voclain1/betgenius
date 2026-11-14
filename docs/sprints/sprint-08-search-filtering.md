# Sprint 08 — Search, Filtering & Discovery Simplification

A correctness and simplification sprint on the existing match finder
(`/predictions#discover`, and the same finder inside each category page). No
second search system, no new filter, no new index, no new request on the page.
Six verified defects fixed, three pieces of clutter removed, one new element
added (the active-filter chip) because it replaces a three-step task with one.

Starting master: `e070c89` (Sprint 08 discovery from PR #184 is merged and is
the engine being kept). **Production was not reachable from this environment,
so every observation below is from a local build with demonstration data, not
from betgenius.ng.**

## 1. Existing search and filtering inventory

| Surface | What it is | Code |
| --- | --- | --- |
| Header search | Teams, leagues and matches that have a published public prediction; one fetch of `/api/search` on first focus, then filtered in the browser; accent-insensitive, ranked | `SearchBox.tsx`, `getSearchIndex` |
| Homepage entry | An icon / "Find a match" link to `/predictions#discover` | `DiscoveryEntry` |
| Match finder | A Team box + Search, and a collapsed "Filters" panel: Date, Competition, Market, Match status, Kickoff window, Published category (index only), Your interests, "Only with usable named quotes"; results: 12 per page, cap 300 | `PredictionDiscovery.tsx`, `predictionDiscovery.ts`, `predictionDiscoveryData.ts` |
| Category pages | The same finder with the category fixed, replacing the feed when a filter is set; Yesterday/Today/Tomorrow tabs above | `[category]/page.tsx`, `FeedDayTabs` |
| Result cards | Category, save, competition, teams, kickoff and status, market and pick, quote line, "View match" | `PredictionDiscovery.tsx` |

URL state is carried by `d_*` parameters (a plain GET form), so every search is
shareable, bookmarkable, and one history entry; filtered URLs are `noindex`.

## 2. Verified problems

Each reproduced in a real browser against the untouched master build, signed
out, on a seeded throwaway database (UTF-8; see §11).

1. **Two names find nothing.** "arsenal chelsea" and "arsenal vs chelsea" →
   0 results: the box was matched as a substring of *one* team's name. The
   header search had the same hole.
2. **Spacing.** "real  madrid" (two spaces) → 0.
3. **Accents.** "fenerbahce" and "BESIKTAS" → 0, while "fenerbahçe" → 1. (The
   header search is accent-insensitive; the finder was not.)
4. **LIKE wildcards.** "%" and "_____" listed *everything* (Prisma does not
   escape them).
5. **A started match silently disappears.** "bayern" → 0 results although a
   published prediction exists today, because the default status is "Upcoming
   only" once kickoff passes. The empty state said only "Try another date or
   broaden the market, status or interests filters" and the Filters line said
   nothing was active.
6. **The "N active" count is wrong.** A past date showed "1 active" (its
   default status counted as a filter nobody set); a date the reader *did*
   choose counted as none; nothing showed which filters were active unless the
   panel was opened.
7. **Dead control for the majority.** For a signed-out reader three of the four
   "Your interests" options only produced a "sign in" notice.
8. **Redundant card elements.** Every card had two links to the same page
   (title and "View match →", 44px), the card body was not tappable, and the
   same "No usable named quote for this selection." sat on every card that had
   no quote (5 of 5).
9. Checked and **found correct**: team search is case-insensitive; URL
   encoding and hostile text are safe; partials work; pagination and the 300
   cap behave; date validation (31-day window) and Lagos day boundaries; Back
   after two searches returns to the first; VIP-only matches are not found,
   counted or hinted at for a reader without access; no horizontal overflow at
   any width.

## 3. Task measurements (identical conditions)

375px, signed out, same database, same script (`navigation` waited,
interactions = taps, selections, typing and submits). Demonstration data.

| Task | Before | After |
| --- | --- | --- |
| Find a team ("arsenal") | 3, correct | 3, correct |
| Find a specific match ("arsenal chelsea") | 3, **no results** | 3, correct |
| Find predictions for today | 0, correct | 0, correct |
| Find a team playing tomorrow, typed without accents ("fenerbahce") | 5, **no results** | 5, correct |
| Find matches in a competition | 3, correct | 3, correct |
| Find a goals-market prediction | 3, correct | 3, correct |
| Change the date to tomorrow | 3, correct | 3, correct |
| Clear a filter | 3 | **1** |
| Return to a previous search (Back) | 1, correct | 1, correct |
| Open a prediction from the results (tap the card) | tap on the card body **did nothing**; only the title or "View match" worked | 1, works |
| Empty search, then see the match ("bayern") | 6 (open Filters, change status, search) | **4** (one tap on "Include started and finished") |
| Card height (mean of 5) | 287px | **208px** |
| Links per card | 3 | **2** (title, save) |
| "No usable named quote" lines | 5 of 5 cards | **0** |
| Filter controls shown, signed out | 8 | **7** |

No benchmark here is a prediction: they are counts from the same script run
twice. Date change (3) and competition (3) are unchanged on purpose.

## 4. Simplified or removed

- The **"Your interests"** control, for signed-out readers (it did nothing for
  them); a one-line "Sign in to filter by…" remains in the panel.
- The panel's **explanatory paragraph** ("Interests use your existing
  preferences… Access is checked on every visit").
- The **duplicate "View match →" link** on every card (the title is now a
  stretched link over the whole card; the save button sits above it).
- The per-card **"No usable named quote"** line (a quote is still shown, with
  its bookmaker and timestamp, when there is one).
- The filler sentence **"A quiet feed does not lower the publication
  standard"**, replaced by what the search was limited by.
- The phantom **"1 active"** on a past date.
- Label **"Only with usable named quotes"** → **"Only with a bookmaker quote"**.

Reviewed and **kept**, with the reason: *Date* (the date task); *Competition*
and *Market* (their tasks); *Match status* (the only way to see started and
finished matches; now also reachable from the empty state); *Kickoff window* and
*Published category* — no listed task needs them, but there is no usage data in
this repository to show they are unused, and neither duplicates another control
(category pages fix the category; the window answers "what starts soon");
removal is left for when analytics exist.

## 5. Changes implemented

- `src/lib/discoveryText.ts` (new, pure): `searchPhrase` (case, accents, one
  space, "vs / v / - / x" connectors, symbols dropped, 80 chars), `matchesTeamPhrase`
  (phrase in home, away, "home away" or "away home"), `likeContains` (escapes
  `% _ \`), `foldTranslation` (the SQL accent table, derived from the same JS fold).
- `src/lib/discoveryTeamSearch.ts` (new): one bounded (≤ 1000 ids),
  parameterised read of published rows in the day window, matching the phrase
  accent- and case-insensitively. A **prefilter**: the existing query still
  applies every access, category, market, status and visibility rule to these
  ids, so a hidden row's id is never returned or counted.
- `predictionDiscoveryData.ts`: the team clause now reads `id IN (prefilter)`
  instead of `contains`; nothing else in the query changed (candidate cap,
  truncation and pagination behave as before; #184's own Postgres check passes).
- `src/lib/discoveryFilters.ts` (new, pure): `activeFilters` (only what differs
  from the unfiltered page), `withoutFilter` (one filter removed, others and the
  day tab kept, page reset), `emptyState` (names the limits, offers the fixes).
- `predictionDiscovery.ts`: `parseDiscovery` also returns `today`, `defaultDate`
  and `defaultState` (additive).
- `PredictionDiscovery.tsx`: removable **active-filter chips** outside the
  collapsed panel (the one element added; ≥ 36px; each a plain link), a correct
  count, the simplifications above, `DiscoveryResultCard` and `DiscoveryEmpty`
  extracted so they can be tested.
- `SearchBox.tsx` (header): "arsenal chelsea" / "arsenal vs chelsea" and double
  spaces now find the fixture.

## 6. Deliberately not built

A new search index, `unaccent` or any database extension, autocomplete or
suggestions (would also need an entitlement review), searching competition
names in the Team box (the Competition control and the header search do that),
quick Yesterday/Today/Tomorrow tabs on `/predictions`, new filters, saved
searches, a results counter by category, per-keystroke queries, polling.

## 7. Protected-workstream ownership matrix

| Area | Owner | Sprint 08 |
| --- | --- | --- |
| Discovery engine and its access rules (`discoveryAccessWhere`, `rowViewable`, `canViewCategory`, feed `where`s) | VIP Reliability (#184) | kept; the team clause alone changed, access rules still run on every row |
| Evidence, odds and quote selection (`selectionQuote`), market comparison, publishing, settlement, generation | VIP Reliability | not touched |
| Forecasting research | research | not touched |
| Entitlements, payments | protected | not touched |
| Sitemap, canonicals, noindex rules, `/api/search` index | SEO / product | not touched |
| Finder UI, query reading, filter chips, empty state | Product Transformation | edited here |

## 8. Screenshots

`docs/sprints/screenshots/sprint-08/{before,after}/` — real renders of the
running app at 375 and 1440px: default, filters open, active filters, a past
date, an empty search ("bayern"), an accent-free search ("fenerbahce", tomorrow),
a two-name search. **Demonstration data** on a throwaway database (invented
fixtures, plus a Turkish fixture with accented names and a VIP-only fixture);
not production. `tasks-{before,after}-375.json` hold the task measurements.

## 9. Test results

| Check | Result |
| --- | --- |
| `check-discovery-search` (query reading, SQL pieces, active filters, removal URLs, empty state, boundaries) | 42 pass |
| `check-discovery-search-render` (form, chips, card, empty state, wording) | 25 pass |
| `check-discovery-search-browser` (real page, 320/375/414/768/1440; needs `BASE_URL`) | 78 pass |
| `check-discovery-search-db` (disposable Postgres: accents, two names, spacing, wildcards, hostile text, VIP masking and counts, Lagos 23:30/00:30 edges, combined filters) | 33 pass |
| #184's `check-sprint08` (updated: the interests control is signed-in only) | 92 pass |
| #184's `check-sprint08-postgres` (CI-shaped disposable DB: caps, filters, access, saves) | 83 pass |
| #184's `check-sprint08-browser` (synthetic preview, three widths) | 122 pass |
| Header search, real browser: "arsenal chelsea", "arsenal vs chelsea", "ARSENAL  CHELSEA", "real   madrid", "atletico" | all find the fixture |
| `tsc`, `next build`, budgets | pass |
| `npm run preflight` (site up) | 106/109 |
| Integration, one at a time: tier-provenance 30, vip-premium-gate 30, betofday-targeting 7, personalization-db 65, match-centre-db 9, prediction-experience-db 9 | all pass |

The three preflight failures are baseline, unrelated: `check-house-banners`,
`check-goals-category` (fail on `master`) and `check-db-safety` (only because a
local `.env` database identity is present). The first run of the new database
check failed against a `SQL_ASCII` test database (see §11); on UTF-8 it passes.

## 10. Performance comparison

No new request on the page, no client library. The team search is one
parameterised, date-bounded read of at most 1,000 ids, run **only when text was
typed**, in place of the `ILIKE` that sat inside the main query (which still
returns at most 301 rows). Route sizes are unchanged (`/predictions` 210 B,
113 kB first load; `/predictions/[category]` 4.16 kB, 124 kB; both server
components). Shared JS 110.5 KB; page budgets: homepage 154.6 KB, **match page
159.2 of 160 KB, unchanged** (the one client change, in `SearchBox`, is a few
bytes). Not measured: query timing at production data volume.

## 11. SEO and entitlement review

- SEO: no new indexable URL; any `d_*` parameter stays `noindex, follow`;
  canonicals, sitemap, `/api/search` and category content untouched; the
  finder's copy says nothing new about outcomes.
- Entitlement: access is enforced where it was (the discovery query and
  `rowViewable`), on every row, after the prefilter. Tested end to end: a
  VIP-only match is not found by a signed-out or free reader, is found by a VIP
  reader, and the signed-out count differs from VIP's by exactly one with no
  mention of the hidden fixture in anything returned. The header index already
  excluded paid predictions (`discoveryAccessWhere(ANONYMOUS)`) and still does.

## 12. Known limitations

- **UTF-8 required.** The accent fold uses `translate()`, which is byte-wise in
  a `SQL_ASCII` database. Production Postgres and CI's `postgres:16` are UTF-8;
  a developer database created without an encoding may not be (documented in
  `docs/PREFLIGHT.md`).
- The fold covers Latin letters (U+00C0–U+024F, plus ß and a few fixed folds); a
  name in another script is matched literally.
- The team box still matches teams only; a competition typed there finds
  nothing (use the Competition control or the header search).
- A submitted form writes default values (`d_date`, `d_state`) into the URL, so a
  bookmarked search replays its own date; the empty state's links soften this.
- The default "Upcoming only" still hides started matches until the reader
  includes them; the sprint makes this visible and one tap, not different.
- `Kickoff window` and `Published category` stay until usage data supports
  removing them.
- Production was not observable here; all numbers are local, demonstration data.

## 13. Merge readiness

Ready for review. Merges cleanly into `master`; the discovery engine's own
regression checks pass. Not merged or deployed.
