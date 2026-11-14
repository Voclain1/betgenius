# Sprint 07 — Homepage Experience & Conversion

A focused homepage pass, not a redesign. The audit found a hero that spends the
first phone screen on text, no sign-up path on a phone, a homepage that sells the
plan to people who already hold it, a category block that wrapped into ~360px of
pills, and no link to match research. Each is fixed in place with the existing
components and styling; nothing was added as a new section.

Starting master: `7aff92b`. Open PR #191 (forecasting research) was not touched.
No schema, request, dependency, route, payment flow, popup or banner.

## 1. Existing homepage audit

Measured on a real build against a seeded throwaway database (demonstration
data), as a signed-out, a free and an active VIP reader, at 320, 375, 414, 768
and 1440px. The page is cached (`revalidate = 60`) and renders identically for
every reader; who is reading is known only in the browser.

Top to bottom: hero (H1 built by `homeHeadline`, the answer paragraph by
`homeSummary`, a supporting sentence, "Today's tips" / "Go VIP" / "Find a match",
and a "Top pick today" card), the category shortcuts, Genius tips, Bet of the Day
(only while it holds a pick), Featured tips, Predictions by competition, ad
slots, Recent results, Browse by league, "More from BetGenius" tool tiles, the
long-tail explainer, footer. Prediction discovery is `DiscoveryEntry` (#184's
component, left as is).

## 2. Verified friction

1. **First screen is text.** On a 375×800 phone the answer paragraph and the
   supporting sentence (11 lines) sat above the buttons: "Today's tips" started
   565px down.
2. **No sign-up path on a phone.** The header shows no Join or Log in below `lg`
   (only the logo, app icon and menu), and the hero had no registration link.
3. **A paying reader is sold the plan they hold:** an active VIP reader's
   homepage still showed "Go VIP", and nothing led a signed-in reader back to
   their dashboard or saved predictions.
4. **Category shortcuts took 361px on a phone** (three wrapped rows of pills, a
   chip row, a second group) and started 1,054px down.
5. **Genius and Featured had no shortcut** (only a button inside their sections,
   and none at all when a section is empty); **match research was unlinked** from
   the homepage.
6. **Small tap targets owned by the homepage:** "View all →" 20px and
   "All leagues →" 17px tall.
7. No click measurement for any homepage link.

Checked and found fine, so left alone: no sideways overflow at any width (0 of 15
views), one H1, canonical and metadata, structured data, the explainer, ad
placement, "Banker" vs "Bet of the Day" separation, premium masking (a free
reader's homepage lists no VIP pick). The 19-screen mobile length comes from the
tip tables, ad slots, league list and the SEO explainer; none of it was cut.

## 3. Protected-workstream ownership matrix

| Area | Owner | Sprint 07 |
| --- | --- | --- |
| Discovery (`PredictionDiscovery`, filters), evidence, market comparison, odds, publishing (merged #184) | VIP Reliability | not touched; `DiscoveryEntry` used as is |
| Forecasting research (`research/**`, research workflow and docs; merged #189, open #191) | Forecasting research | not touched |
| Generation, selection, settlement, entitlements, payments, cron | protected | not touched |
| Homepage page, hero actions, category links, tool tiles, homepage analytics | Product Transformation | edited here |
| `package.json` | shared | script lines only |

PR #191 changes 10 files, all under `research/`, `docs/research/` or `.github/`:
no overlap. A static test fails if a new file imports discovery, odds, generation,
settlement, research or the database.

## 4. Changes implemented

- **Hero order** (`src/app/(public)/page.tsx`): the actions come straight after
  the answer; the supporting sentence follows them, word for word, still in the
  hero. "Today's tips" is 128px higher on a phone (565 → 437px) and inside the
  first screen at every width.
- **Account line** (`HomeAccountActions`, client): one quiet line under the
  buttons. A visitor sees "Save picks and follow teams with a free account. Join
  free" (→ `/register`); a signed-in reader sees "Welcome back · My dashboard ·
  Saved predictions". Not a banner: one line of small text, no box, no dismissal.
  Its height is reserved, so nothing moves when the session resolves (CLS ≤ 0.008).
- **"Go VIP" hidden for an active VIP or Premium plan** (`HomeUpgradeButton`);
  shown to visitors, free readers, and any plan that is not active.
- **Category shortcuts:** one scrolling line per group on a phone (block 361 →
  261px), wrapping from `sm` as before; pills still ≥ 36px; **Genius Tips** and
  **Featured Tips** (the editor's picks) added, keeping the "…Tips" labelling
  rule. Market chips and Longer runs unchanged.
- **Match research:** a "Match insights" tile (existing `/match-insights`) in
  "More from BetGenius"; the four tiles sit two-across on a phone so the section
  is shorter than before.
- "View all →" and "All leagues →" are at least 36px tall.
- **Analytics:** one event, `home_click {target, placement}` (section 10).

## 5. Deliberately excluded

- No new section, banner, popup, urgency or discount message, and no Premium
  promotion beyond the existing button.
- **Bet of the Day is not a category button.** The owner's existing rule is that
  it appears only while it holds a pick (an empty heading would advertise a
  promise the page is not keeping); it keeps that, and stays distinct from Banker.
- No second category hub or filter (#184 owns discovery); no new route.
- No change to the SEO copy, the explainer, metadata, structured data, or the
  homepage's caching; `HomepageExplainer`, `HeroSlider`, `AnswerSummary` untouched.
- No viewer-specific server rendering (it would end the cache).
- Not tracked: market chips and prediction rows (shared components used on other
  pages); they are measured from GA4 page paths (section 10).

## 6. Before and after

`docs/sprints/screenshots/sprint-07/{before,after}/` — real renders of the
running homepage at 375 and 1440px (first screen and full page, signed out;
first screen free and VIP), `before` = `master`, `after` = this branch, same
data. **Demonstration data:** a throwaway local database with invented fixtures
and demo accounts; not production. Crests are blocked images in this environment.

| Signed out | 320 | 375 | 414 | 768 | 1440 |
| --- | --- | --- | --- | --- | --- |
| "Today's tips" top (px) | 640 → 488 | 565 → 437 | 542 → 414 | 519 → 433 | 567 → 481 |
| Category block height (px) | 362 → 262 | 361 → 261 | 362 → 262 | 265 → 257 | 148 → 194 |
| Page height (px) | 17260 → 17280 | 15152 → 15136 | 14213 → 14156 | 10131 → 10288 | 8585 → 8663 |
| Targets under 36px in `main` | 16 → 14 | 18 → 16 | 18 → 16 | 20 → 18 | 22 → 20 |

Honest limits: the category shortcuts still start below the first phone screen
(~1,100px, because the hero text and the "Top pick today" card come first and the
account line adds ~50px), and at 768/1440px the page is slightly longer (two more
pills, the fourth tile, the account line). Page length on a phone is unchanged.

## 7. Test results

| Check | Result |
| --- | --- |
| `check-homepage-experience` (links, routes, SEO surface, analytics, boundaries) | 52 pass |
| `check-homepage-experience-render` (visitor, free, VIP, PREMIUM, expired/pending/cancelled VIP, malformed session, line stability, accessibility) | 23 pass |
| `check-homepage-experience-browser` (real page, 320/375/414/768/1440; needs `BASE_URL`) | 55 pass |
| Real-app journey (signed out, free, active VIP; click events captured; VIP-only match absent from a free reader's page) | 12 pass |
| `check-prediction-view` (updated for the two new category buttons) | 141 pass |
| Sprint 01–06 checks, `tsc`, `next build`, page budgets | pass |
| `npm run preflight` (site up) | 103/106 |
| Integration, one at a time, throwaway Postgres: 30 / 30 / 7 / 65 / 9 / 9 | all pass |

The three preflight failures are baseline and unrelated: `check-house-banners`
and `check-goals-category` (fail on `master`), `check-db-safety` (only because a
local `.env` database identity is present).

## 8. SEO preservation evidence

- Metadata strings, canonical `"/"`, the noindex rule for dated views, the H1 and
  answer builders, the supporting sentence (verbatim), the explainer, the
  structured data and `revalidate = 60` are asserted unchanged by the pure check.
- Rendered text, before against after (signed out, 375px): nothing removed;
  added only the account line, "Genius Tips", "Featured Tips" and the "Match
  insights" tile; the supporting sentence moved a few lines down within the hero.
- Internal links, before against after: 49 unique destinations, none removed;
  two added (`/register`, `/match-insights`); all 14 category, market and
  longer-run destinations present.
- One H1; no copy says AI; no guarantee wording.

## 9. Performance impact

No new request, query or dependency; the page's four Prisma calls and its cache
rule are unchanged. Homepage route JS 6.31 → 6.8 kB (First Load 135 kB both);
page budget 154.1 → 154.6 of 160 KB. Shared JS 110.5 KB, unchanged. **Match
page 159.2 of 160 KB, unchanged: no shared code was added.** Layout stability:
CLS 0.001 signed out, ≤ 0.008 signed in (was 0.04 until the line's height was
reserved). Mobile overflow: none at 320–1440px.

## 10. Analytics measurement plan

New: `home_click {target, placement}` (registered in `HOMEPAGE_EVENTS`, listed in
`docs/SEO_ANALYTICS_EVENTS.md`). `target` is one fixed word for the destination
(`today`, `genius`, `register`, `dashboard`, `match_insights`, …); `placement` is
`hero`, `category_nav`, `account_line`, `section` or `tools`. Sent only on a
click, from one place (`HomeLink`); no label, name, id or prediction detail.
Register `target` and `placement` as event-scoped custom dimensions.

- **Homepage → prediction click-through:** GA4 Explore → Path exploration, start
  at `page_template = home`, next step `page_template = match`; or sessions where
  `page_referrer` is the homepage and the next page is a match page, divided by
  homepage sessions. (Prediction rows are shared components and send no event.)
- **Homepage → category navigation:** `home_click` with `placement =
  category_nav`, by `target`, divided by homepage `page_view`s; market-chip use
  from the next-page path (`/predictions/btts` etc.).
- **Account-registration intent:** `home_click` `target = register` (line
  clicks), then GA4's existing `sign_up`; intent rate = line clicks ÷ homepage
  sessions of signed-out visitors, completion = `sign_up` in the same session.
- **Returning-user navigation:** `home_click` `target = dashboard | saved`
  against homepage sessions of readers with a `dashboard_view` in the last 28
  days (an audience).
- **Mobile versus desktop:** every breakdown above split by `Device category`.
- Not claimed: no conversion improvement until real traffic data shows one;
  consent-denied sessions send nothing; compare equal periods before and after
  deploy, and keep the baseline in `metrics.json` for the layout numbers.

## 11. Known limitations

- Category shortcuts start ~1,100px down on a phone (see section 6).
- Signed-in readers see the visitor line for the moment before the session
  loads (no layout shift; the text swaps).
- A reader whose plan is paid but whose session says otherwise still sees "Go
  VIP" until the session refreshes.
- `DiscoveryEntry` is an icon-only link on phones (#184's component, unchanged).
- Demonstration data only; no production capture.

## 12. Merge readiness

Ready for review. Merges cleanly into `master`; no file overlaps #191. Not
merged or deployed.
