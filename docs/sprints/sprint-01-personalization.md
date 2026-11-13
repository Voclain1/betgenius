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
free ticket, dashboard) and in the prediction table at every width (see
§2a). Filters All / Upcoming / Settled / Won / Lost with counts, 20 per page,
remove. Each bookmark keeps a **snapshot** of the selection as saved, and
**the snapshot decides everything the reader sees**:

| Situation | Shown pick | Result | Status | Listed under |
|---|---|---|---|---|
| Unchanged pick | saved | live outcome | upcoming → awaiting → settled | that result |
| Rewritten, match settled | saved, plus "Updated since you saved it — now X" | saved selection graded from the final score (`resolveMarket`, the auto-settlement resolver) | settled | the **saved** result, never the live row's |
| Rewritten into a market the score alone cannot grade (HT/FT, free text) | saved + notice | none ("saved pick not graded") | settled once the live row settles | Settled only — never Won/Lost |
| Rewritten, match void with no score | saved + notice | VOID | settled | Settled |
| Prediction deleted (FK `SET NULL`) | saved snapshot | none | unavailable | All only — never Upcoming/Settled/Won/Lost |
| Reader can no longer view the category | teams only; pick/odds/confidence withheld server-side | hidden | state only | never Won/Lost (would reveal the result) |

Implementation: `savedPredictionView` computes one `SavedView` per bookmark;
`matchesSavedFilter`, `orderSaved` and `recentlySettled` (all pure) derive the
filters, counts, ordering and the overview's "recently settled" from those
same values. There is no SQL filter on the live prediction's outcome any more,
and no denormalised "saved result" column that a separate settlement job would
have to keep in step. A user has at most 500 bookmarks (enforced on save), so
this is one bounded, indexed read per page.

### 2a. Bookmark in the prediction tables
- **≥ 768 px**: in the Kickoff cell.
- **640–767 px** (Kickoff column hidden): in the Over/Under cell.
- **< 640 px** (phone grid): a 32 px button stacked above the chevron in the
  grid's existing third column. No column is added: the ad rows' `colSpan`
  formula and `<th>` count are unchanged (asserted), and the button sits
  above the row's stretched link (`relative z-10`), so tapping it saves while
  tapping the row still opens the match.
- Measured on iPhone SE / 13 / Pixel 5: **row heights identical** with and
  without the button (117 px); team-name column 10 px narrower (178 vs 188 px
  on SE) with no truncation in the sample; no horizontal overflow; keyboard
  operable (`aria-pressed`, labelled). Never shown on locked rows.

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
| `npm run check:personalization` (pure, in preflight) | **174 passed, 0 failed** |
| `check-personalization-db.ts` (integration tier, run against a disposable local Postgres 16) | **65 passed, 0 failed** |
| `tsc --noEmit` | pass |
| `next build` (includes lint/type pass) | pass |
| `npm run check:budgets` | all 73 pages within budget |
| Render checks touching changed components (`check-prediction-view`, `check-match-render`, `check-match-insights-render`, `check-dashboard-logout`) | pass |
| `npm run preflight` (full pure tier), run on untouched `master` (b3d2fdb, separate worktree) and on this branch, both without a local `.env` | master **79/82**, branch **80/83** (the extra step is `check-personalization`, passing). The same three fail on both with **byte-identical failure lines**: `check-house-banners` (2 banner-slot assertions), `check-goals-category` ("GOALS feed re-filters and keeps display ordering"), `check-sitemap-scoping` (asserts `predictionScope.ts`'s team select excludes `coachJson`). None touches Sprint 01 code; none was modified here. |
| Browser end-to-end (Playwright, production build, local DB) | login → dashboard; preferences search+save; settled filter; onboarding with Back/Next/Finish and persisted completion (no second redirect); existing-user invitation (no redirect); signed-out save → `/login?callbackUrl=…`; no horizontal overflow on iPhone 13 for dashboard, saved, preferences, onboarding |

Pure suite covers: market list derivation, timezone validation (incl. ICU
aliases) and DST/half-hour day bounds, input validation and duplicate collapse,
ranking order, upcoming exclusion of completed/settled fixtures, snapshot
settlement and no-substitution, premium masking, onboarding targeting (new vs
existing, payment callbacks), access decision order (401 → 403 → 429), rate
limiter, analytics payload hygiene, "no AI wording" and guarantee-free copy,
and the CLAUDE.md design rules (no accent stripes, no tinted pills).

Regression tests added in the release-hardening pass: filters for a
rewritten pick (live LOST, saved WON → listed under Won, not Lost; counts
agree; overview shows WON); deleted prediction with a future kickoff (not
Upcoming/Settled/Won/Lost, still under All, not on the overview); a won locked
pick is invisible to the Won filter and its count; ungradeable rewrite and
void-without-score; ordering; table bookmark structure.

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

- **Upcoming fixtures** depend on the league caches refreshed by the existing
  enrichment cron; a postponement is reflected only after the next refresh.
  Kickoff time, never the cached status, decides what is "upcoming".
- **Rate limiter** is in-process (correct for the single VPS server; per
  instance on a multi-instance host). Writes are idempotent and capped regardless.
- **Notification preferences**: integrated by link and timezone sync only; full
  notification work is a later sprint.
- No ESLint config exists in the repo (`next lint` offers to create one); the
  build's lint/type pass is what ran.
- Resolved in the hardening pass: saved filters now follow the saved selection
  (§2), and the phone table has a bookmark (§2a).

## Deployment and migration

### Exactly what changes in the database
`git diff master -- prisma/schema.prisma` is **70 insertions, 0 deletions**:
two new models and three back-relation fields (`User.preference`,
`User.savedPredictions`, `Prediction.savedBy`). Back-relations are Prisma-only
and produce no SQL. `prisma migrate diff` from master's schema to this one
yields only:

- `CREATE TABLE "UserPreference"`, `CREATE TABLE "SavedPrediction"`
- 5 indexes, all on those new tables (2 unique: `UserPreference.userId`,
  `SavedPrediction(userId, predictionId)`)
- 3 foreign keys, all *from* the new tables: → `User` (`ON DELETE CASCADE`) ×2,
  → `Prediction` (`ON DELETE SET NULL`)

No existing table, column, default, index, constraint or relation changes; no
data is written. Adding a foreign key briefly takes a `SHARE ROW EXCLUSIVE`
lock on `User` and `Prediction`; because the new tables are empty the
constraint validates instantly, so the lock is held for milliseconds.

### Which database `db-push` modifies
The workflow (`.github/workflows/db-push.yml`, manual `workflow_dispatch`
only) connects with the **repository secrets `DATABASE_URL` and
`DATABASE_URL_UNPOOLED`** — the same secrets the VPS deploy passes to the
production build. That is the **production database**:
- while the repository variable `DB_ON_VPS` is unset: the Neon database those
  secrets name;
- when `DB_ON_VPS=true`: the VPS Postgres, reached through an SSH tunnel
  (`.github/actions/vps-db-tunnel`, runner `localhost:5432` → VPS `127.0.0.1:5433`),
  with the secrets pointing at `127.0.0.1:5432/betgenius`.
Secret values are not visible from the repository; confirm the target in
GitHub → Settings → Secrets and variables before running.

### Its safety checks, in order
1. `concurrency: db-push` — one run at a time.
2. **Plan**: `prisma migrate diff --from-schema-datasource` (introspects the
   live database) `--to-schema-datamodel` (this branch) prints the SQL.
3. **Additive gate**: the job fails if the plan contains `DROP`, `ALTER COLUMN
   … TYPE`, `RENAME` or `ALTER TYPE`. This also catches drift: if production
   had objects the schema lacks, the plan would contain `DROP` and stop.
4. **Push**: `prisma db push --skip-generate` **without** `--accept-data-loss`,
   so Prisma itself refuses any change it classifies as data-losing.
5. **Verify**: `npm run check:schema` confirms the database now matches.
Known gaps (not changed here — unrelated to this sprint): the plan and the
push are computed separately (no lock between them), and the grep would not
flag a non-destructive but locking change such as `SET NOT NULL` on a large
table. Neither applies to this plan.

### Order of operations (required)
1. **Before merging**, run Actions → **db-push** on branch
   `ccr-666ad6e8-0rzntk` and check the printed plan matches the SQL above
   (two `CREATE TABLE`, five `CREATE INDEX`, three `ADD CONSTRAINT … FOREIGN KEY`).
2. PR preflight's schema-sync step turns green; merge.
3. The VPS deploy (on push to `master` when `VPS_DEPLOY_ENABLED`) builds as usual.
   **Do not merge first**: `check-schema-sync` would fail that build, and if
   the database were unreachable at build time (that check then only warns)
   the deployed `/dashboard` would error on the missing tables.
4. No backfill, env vars or secrets. Optional: GA4 custom dimensions `source`,
   `step`, `personalized`.

Rollback: revert the code; the two tables are unused by earlier versions and
can stay. Dropping them later is a manual, deliberate step (db-push refuses it).

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
