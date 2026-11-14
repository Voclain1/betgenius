# Sprint 04 — Prediction Category Architecture & Navigation

A navigation sprint. The Tips menu now says what kind of thing each link is,
shows which page the reader is on, and reaches pages it used to hide. No
prediction data, category page, loader, guide or ROI display changed.

Starting master: `afe07d7`. Compared against open PR #184 (Sprint 08) at
`c4a42ab`, which was left completely alone.

## 1. Current category inventory

| Kind | Route | Source | Reachable from the header before |
| --- | --- | --- | --- |
| Time | `/predictions/today` | `[category]` (TODAY) | yes |
| Time | `/predictions/weekend`, `/predictions/midweek` | own pages (`PeriodPredictionsPage`) | **no** (homepage and guide text only) |
| Curated | `/predictions/genius`, `featured`, `banker`, `goals`, `combo-bets` | `[category]` | yes |
| Curated | `/predictions/bet-of-the-day` | own page | **no** (homepage / index only) |
| Members | `/predictions/vip`, `/predictions/premium` | `[category]` | yes (★ / ◆) |
| Market | `/predictions/straight-wins`, `double-chance`, `btts`, `over-2-5-goals` | own pages, `marketHubs.ts` | yes, under "By market" |
| Competition | `/predictions/league/[slug]`, `team`, `cup`, `match`, `h2h` | scope pages | by search / links, no index page |
| Multi-bet | `/multi-bets` | own page | yes (primary link) |

"Expert Picks" is not a route; the nearest product is Featured ("editor-picked"),
which keeps its name. The `/combos` page is empty and stays unadvertised.

## 2. Verified UX problems

Measured on a real build (25 page × width combinations):

1. **No current-page state anywhere in the header.** 0 `aria-current` links on
   every page and width, in the dropdown, the drawer and the primary links.
2. **Weekend, Midweek and Bet of the Day were missing from the menu.** Two
   real, indexed pages and one distinct product were reachable only from the
   homepage.
3. **Kinds were mixed.** Time views (Today), curated products (Banker) and
   market pages sat in one list with a "By market" tail. Banker vs Bet of the
   Day was easy to confuse because only one of them had a link.
4. **Long single-column dropdown:** 12 links, 527px tall at 1440×900.
5. The drawer's Tips list had no grouping, so "Today" and "BTTS" read as peers.

Checked and found fine, so left alone: tap targets (all menu links ≥36px),
Escape handling, no page overflow at 320/375/414/768/1440, the market chips
(already `aria-current`), footer links.

## 3. Taxonomy (navigation only)

`src/lib/predictionNav.ts` (new, pure, client-safe) is the one list the desktop
menu, the drawer and the tests read:

- **By day:** Today · Weekend · Midweek
- **Curated tips:** Genius · Featured · Banker · Bet of the Day · Combo Bets ·
  Goals · VIP ★ · Premium ◆
- **By market:** Straight Wins · Double Chance · BTTS · Over 2.5 (from `marketHubs.ts`)

Every existing label and URL is unchanged; Banker and Bet of the Day are two
links with two routes. It also holds `isCurrentPath()` (segment-aware, so
`/predictions/goals` never lights up `/predictions/goals-extra`) and
`onTipsPage()`.

## 4. Changes implemented

- `src/lib/predictionNav.ts` — new taxonomy and current-page helpers.
- `src/components/Nav.tsx`
  - Tips dropdown: two columns (By day + By market | Curated tips), 15 links,
    374px tall instead of 527px.
  - The page the reader is on is `aria-current="page"` with the element's own
    background (no coloured edge); the Tips trigger is marked when the page is
    inside the menu. Applies to primary links, More, and the drawer.
  - Drawer: same three headed groups, and the current page is scrolled into
    view when it opens (before, "you are here" could sit below the fold).
  - Groups are `role="group"` with a label; the trigger sets `aria-controls`.
- `scripts/check-seo.ts` — one existing assertion followed the menu's links to
  their new source file (`predictionNav.ts`); its intent is unchanged.
- Registered the new checks in `package.json`, `scripts/lib/preflightSteps.ts`
  and `docs/PREFLIGHT.md`.

## 5. Left untouched, on purpose

- **Covered by PR #184, not duplicated:** the discovery filter form (market,
  competition, window, odds, saved/category state) on the index, category and
  homepage pages; `FeedDayTabs` sizing; match-page evidence and market
  comparison. None of those files is edited here.
- Category pages, loaders, market classification, selection ordering,
  pagination, SEO guides (BTTS, Over 2.5, Straight Win, Double Chance, Today,
  Banker, Midweek), ROI and statistics displays, metadata, canonicals,
  structured data, sitemap rules.
- `MarketChips`, `CategoryMasthead`, `PredictionCard`, homepage link groups.
- Entitlements, generation, odds, evidence, publishing, settlement, cron,
  API-Football, schema, payments.

No meaningful work remained for a "category hub" or a competition index: the
first would duplicate #184's discovery, the second would be a new landing page.

## 6. Ownership comparison with PR #184

| File / area | #184 | Sprint 04 |
| --- | --- | --- |
| `PredictionDiscovery.tsx`, `predictionDiscovery*.ts` | new | not touched |
| `predictions/page.tsx`, `[category]/page.tsx`, `(public)/page.tsx`, `match/[slug]/page.tsx` | edited | not touched |
| `FeedDayTabs.tsx`, `predictionScope.ts` | edited | not touched |
| `MatchEvidenceGuide`, `PublishedMarketComparison`, `selectionQuote`, `predictionVisibility`, `predictionExplanation` | new | not touched |
| `package.json` | scripts | scripts (separate lines; auto-merges) |
| `Nav.tsx`, `predictionNav.ts`, `check-seo.ts` | not touched | edited / new |

Overlap with #184's 35 files: `package.json` only. A trial merge of #184 into
this branch conflicts only in `match/[slug]/page.tsx`, the same file where #184
already conflicts with `master` (it predates Sprint 02); Sprint 04 does not touch it.

## 7. Before and after

`docs/sprints/screenshots/sprint-04/{before,after}/` — real browser captures of
`/predictions/today`, `/btts`, `/weekend` with the menu open at 320, 375, 414,
768 and 1440px, plus `metrics.json`. The site was run against a throwaway local
database seeded with **demo data** (invented fixtures); only the header is the
subject. Crests are blocked images in this environment.

| Measure | Before | After |
| --- | --- | --- |
| Current page marked (any page, any width) | 0 of 25 | 25 of 25 |
| Desktop menu links / height | 12 / 527px | 15 / 374px |
| Drawer links | 23 | 26 (Weekend, Midweek, Bet of the Day) |
| Page overflow with menu open | none | none |
| Smallest menu link | 36px | 36px |

## 8. Tests

| Check | Result |
| --- | --- |
| `check-category-navigation` (taxonomy, routes, labels, current-page, boundary) | 54 pass |
| `check-category-navigation-render` (real `Nav` per pathname) | 17 pass |
| `check-category-navigation-browser` (open menu/drawer, 5 widths × 3 pages) | 126 pass |
| `check-nav-fit` (header width, 3 sign-in states) | pass |
| `check-seo` | 207 pass |
| Sprint 01–03 checks, `tsc --noEmit`, `next build`, `check:budgets` | pass |

`npm run preflight` first ran 92/97. `check-seo` was the one failure this
branch caused (it read the menu's links from `Nav.tsx`); it is fixed above and
now passes. The four that remain are baseline, not caused by this branch:
`check-house-banners`, `check-goals-category`, `check-sitemap-scoping` (all fail
on `master`) and `check-db-safety` (fails only because a local `.env` database
identity is present).

The browser check needs a running site (`BASE_URL`); without one it skips.

## 9. Performance

Budgets pass (75 pages): shared JS 110.4 / 120 KB, unchanged; match page
157.2 / 160 KB (+0.4 KB from the larger menu in the header chunk); homepage
152.2 KB. No new request, query, dependency or client component; the menu
markup is the same client component with one more small list.

## 10. Cross-sprint compatibility

Sprint 01: the Saved predictions and Following links in the account menu and
drawer are untouched. Sprint 02/03: no match, status, kickoff, table or
dashboard code touched; their checks pass in the preflight above.

## 11. Known limitations and merge readiness

- The drawer is longer by three links; it scrolls and opens at the current page.
- The Tips menu is not arrow-key navigable (Tab/Enter/Escape work); unchanged
  behaviour, out of scope.
- Competition pages still have no index page; adding one would be new.
- The index/category pages are not edited here, so any in-page category
  navigation improvements wait for #184 to land.
- Ready for review. Merges cleanly into `master`; #184 will need its own
  rebase for the match-page conflict regardless.
