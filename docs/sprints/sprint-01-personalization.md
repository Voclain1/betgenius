# Sprint 01 — Personalized user experience

Status: implemented on branch `ccr-666ad6e8-0rzntk`, not merged, not deployed.
Schema change must be pushed with the `db-push` workflow **before** merge (see
[Deployment](#deployment-and-migration)).

## 1. Repository audit (what already existed)

| Area | Found | Used how |
|---|---|---|
| Framework | Next.js 14 App Router, React 18, Tailwind with CSS-variable tokens (`globals.css`, `tailwind.config.ts`) | Unchanged; all new UI uses existing tokens and `.btn` / `.card` classes |
| Auth | NextAuth v4, JWT sessions, Credentials + Google + One Tap; `middleware.ts` protects `/dashboard` and `/admin` | Reused. No new auth. Every new endpoint calls `getServerSession` |
| DB / ORM | Postgres + Prisma 5, schema shipped with `prisma db push` (no migrations folder); `check-schema-sync` gates builds | Two additive models |
| Users / subscriptions | `User`, `Subscription`; entitlement resolved per request from the DB (`entitlement.ts`, `viewerEntitlement.ts`) — never from JWT claims | Reused for every premium decision |
| Access rule | `canViewCategory` + `presentedCategory` (`access.ts`) | The only gate used by dashboard, save and saved list |
| Dashboard | `/dashboard` with `?section=` (overview, category feeds, track record, account), `DashboardShell` sidebar, payment confirmation, post-signup upsell | Extended in place; no competing dashboard |
| Predictions | `Prediction` with provider ids (`homeTeamApiId`, `awayTeamApiId`, `leagueApiId`, `fixtureApiId`), structured `marketType` + `selection`, `outcome`, final scores; feed rules in `categoryFeedWhere` | Read-only. Prediction engine untouched |
| Fixtures | `Fixture`/`Team`/`League` tables are dormant. Upcoming fixtures live in `LeagueEnrichmentCache.upcomingJson`; team → league in `TeamEnrichmentCache` | Used for "upcoming for you" |
| **Favourites** | **`UserFollow`** (TEAM / LEAGUE / PREDICTION / CATEGORY, unique per user+type+key), `/api/follows`, `FollowButton` on team/league/match/category pages, `/following` feed, notification fan-out | **Reused as favourite teams/competitions** — no duplicate table |
| Notifications | `NotificationPreference` (incl. `timezone`, quiet hours), push, inbox, `/notifications` | Linked from account; timezone kept in step |
| Bookmarks | None. A PREDICTION follow means "alert me about this match", not "save this pick" | New `SavedPrediction` |
| Preferences | None beyond notification settings | New `UserPreference` |
| CSRF | `hasValidMutationOrigin` | Reused on every write |
| Rate limiting | None for user endpoints | Added `src/lib/rateLimit.ts` |
| Analytics | GA4 + Meta via consent-moded tag; `trackEngagement` with `page_template`, no free text | Extended with personalization events |
| Tests | `tsx` assertion scripts grouped by `scripts/lib/preflightSteps.ts` into pure / read-only DB / integration tiers | Two new suites in that structure |

Incomplete before this sprint: no preferences, no bookmarks, no onboarding, no
personal ranking, no timezone display choice, no rate limits on account writes.

## 2. What was implemented

### Personalized dashboard — `/dashboard`
- Date in the user's timezone, greeting, edit-preferences action.
- **For you today**: today's published picks (the user's own calendar day), ranked
  followed team → followed competition → preferred market → kickoff relevance →
  the site's existing display ranking; one pick per fixture; each row says why
  it is there ("Your team · Your market"). Non-matching picks follow under
  "Also today". With no preferences the section is "Today's top predictions"
  in the existing ranking — no preferences are invented.
- **Upcoming for you**: fixtures for followed teams/competitions (league caches
  + published predictions), with competition, kickoff, status
  (Scheduled / Starting soon), "Prediction ready" indicator and link to the
  match page. Anything at or before now, or whose prediction has settled, is
  never listed.
- **Saved**: next saved picks to play and recently settled ones with result.
- **Your favourites**, the existing subscription banner and category tiles.
- Empty states with one next action each (no favourites, no saved, no upcoming,
  nothing relevant today, nothing published yet).

### Preferences — `/dashboard/preferences`
Searchable team picker (teams the site has published predictions for, by
provider id), searchable competition picker (catalogue, most-followed first,
"show all"), preferred markets (derived from `MARKET_TYPES`; `OTHER` and
`SAME_GAME_DOUBLE` excluded by type), timezone (IANA, Lagos default, full list).
Add, remove, discard, save (one request, one transaction), reset (two-step
confirm). Saving refreshes server components without a full reload.

### Onboarding — `/dashboard/welcome`
Welcome → competitions → teams → markets → done. Progress bar + "Step n of 5",
Back/Next, Skip at every step, focus moved to each step heading, sticky action
bar on phones. Saves once on Finish (and adopts the browser's timezone if it is
valid and the user had not chosen one). Completion/skip persisted.
**Who sees it:** only accounts created in the last 24 h with no preference row
and no team/league follows, and only when they open bare `/dashboard` (never a
payment callback or `?section=`). Older accounts get a dismissible one-line
invitation on the dashboard instead. Revisitable from Preferences.

### Saved predictions — `/dashboard/saved`
Bookmark control on every prediction card (feeds' detailed view, match page,
free ticket, dashboard) and in the desktop prediction table. Filters
All / Upcoming / Settled / Won / Lost, 20 per page, remove. Each bookmark keeps a
**snapshot** of the selection as saved:
- the saved pick is always what is shown; if the prediction was rewritten the
  row says "Updated since you saved it — now X";
- result: the live outcome when the selection is unchanged; after a rewrite the
  saved selection is settled from the final score with the same resolver
  auto-settlement uses (`resolveMarket`), or left unresolved for free-text markets;
- a hard-deleted prediction leaves the bookmark (FK `SET NULL`), shown as
  "No longer published · result unavailable".

### Favourites and account
- `FollowButton` (existing) remains the follow/unfollow control on team, league
  and match pages; it now emits analytics. Signed-out visitors get a sign-in
  link that returns them to the page (`callbackUrl`) — for follow and save.
- Account section: profile (name, email, member since), subscription banner
  (unchanged billing), favourites, markets, timezone, saved count, links to
  notification and email settings.
- Sidebar regrouped: My dashboard, Saved predictions, Preferences, then
  Predictions and More (Notifications added).

## 3. Architecture decisions

1. **Favourites = `UserFollow`.** Alerts already fan out on these rows. A second
   favourites table would let "my teams" on the dashboard and for alerts drift.
   Consequence: following a team from Preferences also makes it eligible for
   followed-team alerts — governed by the existing `followedAlerts` setting.
2. **Snapshot bookmarks** rather than a pointer, so a rewrite can never silently
   change what a user saved, and deletion cannot erase it.
3. **Saving requires the viewer can see the pick now** (403 otherwise). The
   saved list re-checks access on every render against the live row's
   categories; a lapsed subscriber's bookmark is locked and the market, pick,
   odds and confidence are dropped **server-side** before reaching the client.
4. **Dashboard fetches only what the viewer may read**: the Today feed (already
   excludes paid-only picks and hidden combo legs) plus VIP/Premium feeds only
   when entitled, each row re-checked.
5. **Pure rules / DB split**: `src/lib/personalization.ts` (no DB, client-safe,
   fully unit tested) and `src/lib/personalizationData.ts` (every function takes
   the session user id first and scopes every query by it).
6. **Timezone**: stored on `UserPreference`; when a `NotificationPreference`
   row already exists its timezone is updated too. No notification row is ever
   created by this screen (row existence affects alert defaults).
7. **Caching**: all account routes and pages are `force-dynamic`; API responses
   carry `cache-control: private, no-store`. The only cross-request cache is the
   public "most covered teams" list (`unstable_cache`, 1 h), which holds no
   personal data. Public pages' caching is unchanged.

## 4. Database changes (additive only)

```prisma
model UserPreference {           // one per user
  userId                String   @unique  → User (cascade)
  preferredMarkets      String[] @default([])
  timezone              String   @default("Africa/Lagos")
  onboardingCompletedAt DateTime?
  onboardingSkippedAt   DateTime?
}
model SavedPrediction {          // snapshot bookmark
  userId       → User (cascade)
  predictionId → Prediction (SET NULL), nullable
  category, marketType, selection, market, pick, odds, confidence,
  homeTeam, awayTeam, homeTeamApiId, awayTeamApiId, leagueApiId, leagueName, kickoff
  @@unique([userId, predictionId])       // no duplicate bookmarks
  @@index([userId, kickoff]) @@index([userId, createdAt]) @@index([predictionId])
}
```
Plus back-relations on `User` and `Prediction`. No column on an existing table,
no drops, no renames, no backfill.

## 5. Routes

| Route | Method | Notes |
|---|---|---|
| `/dashboard` | page | Personalized overview (modified) |
| `/dashboard/saved` | page | New |
| `/dashboard/preferences` | page | New |
| `/dashboard/welcome` | page | New, onboarding |
| `/api/preferences` | GET / PUT / DELETE | New. PUT is partial; lists replace. DELETE = reset |
| `/api/preferences/teams?q=` | GET | New. Team search / most covered |
| `/api/saved-predictions` | GET / POST / DELETE | New. GET returns ids for buttons |
| `/api/follows` | POST / DELETE | Modified: rate limit, 300-follow cap, private GET |

## 6. Security controls

- Server-side session on every page (`loadDashboardContext`, plus middleware)
  and endpoint (`requireAccount`): no session → 401 / redirect to sign-in with
  return path. User id only ever from the signed session.
- Writes: same-site `Origin` check (existing helper) → 403; per-user rate limit
  60 writes/min (search 120/min) → 429 with `Retry-After`.
- Strict zod schemas (`.strict()` rejects a smuggled `userId`), id formats
  checked, provider ids resolved against published data — a client cannot
  follow an arbitrary number or choose the stored label.
- Ownership: every read/delete is `where: { userId, … }`; another user's id
  matches nothing (indistinguishable from nonexistent).
- Duplicates: unique keys + idempotent upserts; concurrent duplicate save
  resolves to the single row; client buttons also guard double submits.
- Caps: 40 teams, 30 competitions, 500 saved, 300 follows.
- Errors: generic messages to clients; details only to server logs.

Verified by HTTP probes against the running app with a real session:
cross-site write 403, origin-less write 403, cross-user delete `{removed:0}`
(victim row intact), malformed id 400, smuggled `userId` 400, garbage session
cookie 401, `cache-control: private, no-store`, 429 after the write budget.

## 7. Analytics

Through the existing `trackEngagement` (consent-moded GA4; no new install):
`dashboard_view`, `onboarding_start`, `onboarding_complete`, `onboarding_skip`,
`favourite_team_add`, `favourite_league_add`, `prediction_save`,
`prediction_unsave`, `preferences_update`, `preferences_reset`. Parameters are
counts and fixed enums only (`PERSONALIZATION_EVENTS` in `engagement.ts`,
asserted by the test suite) — never names, emails, teams or competitions.
Register `source`, `step` and `personalized` as GA4 custom dimensions if needed.

## 8. Tests and verification

| Check | Result |
|---|---|
| `npm run check:personalization` (pure, in preflight) | **157 passed, 0 failed** |
| `check-personalization-db.ts` (integration tier, run against a disposable local Postgres 16) | **53 passed, 0 failed** |
| `tsc --noEmit` | pass |
| `next build` (includes lint/type pass) | pass |
| `npm run check:budgets` | all 73 pages within budget |
| Render checks touching changed components (`check-prediction-view`, `check-match-render`, `check-match-insights-render`, `check-dashboard-logout`) | pass |
| `npm run preflight` (full pure tier) | all pass except 3 checks that fail identically on the untouched base commit (`check-house-banners`, `check-goals-category`, `check-sitemap-scoping` — the last asserts a `predictionScope.ts` select this sprint does not touch). `check-db-safety` passes without a local `.env`; it flags any local DB identity, so it failed only on the disposable dev DB. |
| Browser end-to-end (Playwright, production build, local DB) | login → dashboard; preferences search+save; settled filter; onboarding with Back/Next/Finish and persisted completion (no second redirect); existing-user invitation (no redirect); signed-out save → `/login?callbackUrl=…`; no horizontal overflow on iPhone 13 for dashboard, saved, preferences, onboarding |

Pure suite covers: market list derivation, timezone validation (incl. ICU
aliases) and DST/half-hour day bounds, input validation and duplicate collapse,
ranking order, upcoming exclusion of completed/settled fixtures, snapshot
settlement and no-substitution, premium masking, onboarding targeting (new vs
existing, payment callbacks), access decision order (401 → 403 → 429), rate
limiter, analytics payload hygiene, "no AI wording" and guarantee-free copy,
and the CLAUDE.md design rules (no accent stripes, no tinted pills).

Integration suite covers: create/update/remove preferences, duplicate
prevention, invalid ids, user isolation, timezone sync, follow/unfollow team and
competition, reset (keeps match-alert follows), save/unsave, concurrent
duplicate saves, cross-user unsave by both id kinds, premium refusal for FREE,
masking after lapse, settlement display and rewritten-pick settlement, deleted
prediction, dashboard queries for new user / multiple preferences / no relevant
fixtures, upcoming excludes completed fixtures, cascade on user deletion.

Regression: the homepage, category feeds (Today, Genius, Banker, Featured,
Goals), league and match pages, auth, premium gates, subscription/payment flow
and SEO metadata are untouched apart from the bookmark control added to
`PredictionCard` / the desktop table; the existing render checks and build pass.

## 9. Screenshots

Real application screenshots from a production build against a local database
seeded with demonstration fixtures (team names and crests are API-Football ids;
crest images could not load in the sandbox, so initials show).
See `docs/sprints/screenshots/`.

## 10. Known limitations

- **Saving from the phone table view**: on phones the compact table has no
  bookmark (adding a column would reflow the phone grid and ad rows); phone
  users save from the Detailed view, match pages or the dashboard.
- **Upcoming fixtures** depend on the league caches refreshed by the existing
  enrichment cron; a postponement is reflected only after the next refresh.
  Kickoff time, never the cached status, decides what is "upcoming".
- **Saved filters** Upcoming/Settled/Won/Lost filter on the live outcome; for a
  rewritten pick whose saved selection settles differently from the live row,
  the row itself shows the correct saved result but may appear under the live
  row's filter.
- **Rate limiter** is in-process (correct for the single VPS server; per
  instance on a multi-instance host). Writes are idempotent and capped regardless.
- **Notification preferences**: integrated by link and timezone sync only; full
  notification work is a later sprint.
- No ESLint config exists in the repo (`next lint` offers to create one); the
  build's lint/type pass is what ran.

## Deployment and migration

1. Run **Actions → db-push** on this branch (additive SQL: two tables, indexes,
   FKs). It prints the plan and refuses anything destructive.
2. Preflight's schema-sync check then passes; merge.
3. Deploy as usual. No backfill, no env vars, no secrets.
4. Optional: register the new GA4 custom dimensions (`source`, `step`, `personalized`).

Rollback: the code can be reverted independently; the two new tables are unused
by the previous version and can be left in place.

## Integration notes for later sprints

- **Notifications (full)**: favourites are already `UserFollow` rows, so alert
  fan-out needs no migration; `UserPreference.timezone` is the display zone.
- **Odds intelligence / validation**: the bookmark snapshot stores `odds` and
  `confidence` at save time — a ready "price you saw" record.
- **Category restructuring**: saved items store the presented category and
  re-check access against live categories, so renamed/merged categories only
  need `presentedCategory` to stay correct.
- **Performance analytics**: `SavedPrediction` × outcome gives a per-user
  record; `rankPersonalized` is pure and can take new signals.
- **Global search**: `searchTeams` (provider-id keyed) is reusable.
- **Homepage redesign**: `PickRow`, `UpcomingList` and `SavePredictionButton`
  are standalone components.
