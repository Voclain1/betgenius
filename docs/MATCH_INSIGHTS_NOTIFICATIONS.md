# Match Insights, Following, and Notifications

## Match Insights

### Data

Insights are calculated by `src/lib/insights.ts` (pure) and maintained by `src/lib/insightRefresh.ts` (worker). The worker fetches each target team's last 20 fixtures (`/fixtures?team=X&last=20`, one call per team) into `TeamFixtureHistory`.

`TeamEnrichmentCache.lastFixtures` is deliberately not used. It holds five trimmed summaries without fixture id, status or score breakdown. That is too short for a streak, and it cannot be verified. The existing `last: 5` enrichment call is unchanged because the AI digest and form panels depend on it.

### Accuracy rules

- **Regulation time.** AET and PEN matches use the 90-minute score, validated by settlement's `regulationScoreOf`, which is how bookmakers settle 1X2, goals and BTTS markets. A shootout defeat after 1-1 is a draw.
- **Friendlies** are excluded. **Postponed, cancelled and abandoned** fixtures are skipped.
- **Unverifiable matches end the history.** A completed match with an inconsistent score breakdown, or an awarded result (AWD/WO), stops the history at that point, so two runs are never joined across it.
- **Exact vs "at least".** A streak is stated exactly only when an older verified match ended it. Otherwise the copy says "at least N".
- **Samples.** At least 5 verified matches in scope. Frequencies use the 10 most recent. Streaks need 3 or more; frequencies need 70% or more. "Unbeaten" or "winless" is dropped when it only repeats an equal winning or losing run.
- **Scopes.** All competitions, the team's venue in the target fixture (home form for the home side, away form for the away side), and the target competition. A competition sample identical to all-competitions is not repeated.

### Targets and freshness

- **Targets.** Only teams in a published, unsettled tip kicking off within 7 days. Each team is tied to its soonest such fixture.
- **Refetch.** A history is refetched when it is 6 hours old, or immediately when a match we know the team played has finished since the fetch and is missing from it.
- **Hide, don't serve stale.** A history older than 12 hours, or known to be missing a finished match, is not used. The team's insights are removed.
- **Expiry.** `expiresAt` is the earlier of the target kickoff and the history's 12-hour limit.
- **Replacement.** A team's insights are replaced wholesale on every change, so an insight the latest results contradict disappears immediately.
- **Failures.** A failed fetch is not retried for 30 minutes.

### API cost

One call per team per refetch, bounded per run by `fetchLimit` (default 30, maximum 60). With about 125 upcoming teams that is roughly 500 calls a day, within the Pro plan's 7,500. Calls go through `apiFetch`, so the daily budget gate and throttle apply.

### Top trends panel and page

**Where it appears.** Every page under `/predictions` shows a Top trends panel through `src/app/(public)/predictions/layout.tsx`. From 1280px wide it sits as a right-hand column; on smaller screens it follows the page content. `/match-insights` shows every trend in the same card style.

**What it shows.**
- **Periods:** Today, Tomorrow and Weekend, in Lagos time. The weekend is Saturday and Sunday: the coming one, or the current one while it's under way.
- **Selection:** the panel shows the strongest trend per fixture, up to six. `/match-insights` lists every trend for the period, strongest first, 24 per page.
- **Price:** each card shows the bet its trend literally describes, from the trend team's side of the fixture. Unbeaten means the team or the draw; a winless run means the opponent or the draw; a losing run means the opponent; failed to score or clean sheet means BTTS No. The price shown is the best quoted, and only when at least `MIN_BOOKMAKERS` (5) books quote that exact selection. Otherwise no price is shown.

**Data loading.** The panel fetches `/api/top-trends`, which is edge-cached for 2 minutes, instead of the layout querying the database. Some prediction pages render statically, and a data-reading layout would either freeze the panel at build time or force those pages dynamic.

## Following and entitlement

Following a paid category never grants access. Entitlement is rechecked when the feed and inbox render and when a delivery is claimed. Push copy for VIP and Premium is generic and does not expose selections on a lock screen.

## Events

- **Publishing, changing and withdrawing** a tip record events through `recordPredictionEvents`, inside the same transaction as the change. Both the single-row admin route and the bulk review route use it.
- **Settlement** records result events for published tips only. Hidden double legs never notify anyone.
- **Kickoff reminders** are one per fixture and go to followers of the tip or either team. League and category followers are deliberately excluded, since for them a reminder would become a stream of reminders.

## Environment

Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (normally a monitored `mailto:` URI). The private key is server-only. `CRON_SECRET` bearer authentication protects every worker route.

`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is inlined into the client bundle at build time, so setting it in the environment is not enough on its own: until the app is redeployed, "Enable push" keeps reporting that push is not configured even though the server-side keys are present. The other two are read at runtime and take effect immediately.

If VAPID is absent, following and the in-site inbox still work. Dispatch completes without attempting push, and the test-push endpoint returns `503`.

## Database rollout

The schema process is Prisma `db push`, guarded by `scripts/check-schema-sync.ts`. The change was additive: new tables only, and no existing table or column was altered.

**Current state (checked read-only on 24 Sep 2026).** The notification and insight tables are live in Production: `NotificationEvent`, `NotificationDelivery`, `UserNotification`, `UserFollow`, `NotificationPreference`, `PushSubscription`, `TeamFixtureHistory` and `MatchInsightCache` all hold production rows. The first notification event was recorded on 15 Sep 2026. All three scheduler jobs below have been recording `JobRun` rows since 19 Sep 2026. Preview was not checked from this repository, because `.env` points at a single database.

The steps below are kept for standing up a new environment:

1. Select an isolated preview or development database and verify its host, database and user.
2. Run `npx prisma db push` there, then `npm run check:schema`.
3. Configure `CRON_SECRET`, and all three VAPID values together if browser push is being enabled.
4. Deploy with the scheduler jobs disabled.
5. Run one authenticated `GET /api/admin/refresh-insights?fetchLimit=30`. Repeat until `fetched` reaches 0, then check `/match-insights`.
6. Enable the reminders, dispatch and insights schedules.

Rollback is application-first. Disable the three jobs, roll back the application, and leave the additive tables in place until a separately reviewed cleanup.

## Scheduler configuration

Configure cron-job.org with GET, `Authorization: Bearer <CRON_SECRET>`, and the Africa/Lagos timezone:

| Endpoint | Schedule | `JobRun.job` |
|---|---|---|
| `/api/admin/refresh-insights?fetchLimit=30` | `8,23,38,53 * * * *` | `refresh-insights` |
| `/api/admin/notifications/reminders` | `*/5 * * * *` | `notifications-reminders` |
| `/api/admin/notifications/dispatch` | `*/2 * * * *` | `notifications-dispatch` |

The third column is what `scripts/job-runs.ts` takes, not the path: `npx tsx --env-file=.env scripts/job-runs.ts notifications-dispatch` is how you tell "the cron never fired" from "it fired and had nothing to do". Until each schedule exists these three record nothing, which is exactly what an unconfigured scheduler looks like from inside the app.

The job name comes from the route's code, not from the scheduler, which only calls the URL. `JobRun` has four historical rows named `notification-reminders` (singular), from 20:35 to 20:50 UTC on 19 Sep 2026. That was before the rename to `notifications-reminders` deployed. The plural name took over at 20:55 on the same 5-minute cadence, and the two names never overlap. The singular rows are history, not a second scheduler entry. Leave them in place.

Dispatch behaviour:

- Fans out follows and claims up to 50 deliveries under a 5-minute lease, which is longer than the route's 60-second limit, so a live worker never loses its rows.
- Finalises each row only while it still holds the lease token.
- Retries with exponential backoff up to five attempts and removes 404/410 push endpoints.
- Writes a `JobRun` summary, including how many leases were lost.

External push remains at-least-once. Event keys, delivery keys and notification tags minimise visible duplicates.

## Verification

| Check | Scope | Notes |
|---|---|---|
| `npx tsx scripts/check-insights.ts` | Calculation rules | Includes the legacy cached shape that previously crashed the worker |
| `npx tsx scripts/check-notifications.ts` | Notification policy helpers | Pure, no database |
| `npm run check:notification-digest` | Digest policy and timing | Includes a replay of the 22 Sep 2026 night digest across Lagos midnight through the real `createDailyDigests`. No database |
| `npm run check:inbox-history-cap` | Daily cap by class, night-digest hold | Drives the real dispatch against an in-memory outbox. Shows that history rows pass the cap while push-class rows stay capped at 12, and that the night digest is held from 03:15 to 07:00, then respects quiet hours. No database |
| `npm run check:match-insights` | `/match-insights` and `src/lib/topTrends.ts` | Renders the page against stubbed cache rows: card wording, crest, the matching price and its bookmaker floor, period tabs and bounds, pagination, and the empty state. No database, no network |
| `npx tsx scripts/verify-insight-integration.ts` | Worker behaviour | Refetch rules, a contradicted streak removed at once, stale histories withdrawn. The provider is stubbed. |
| `npx tsx scripts/verify-notification-integration.ts` | Delivery | Fan-out, entitlement, lease races, reminder audience, publish events, rollback |

Both `verify-*` scripts refuse to run anywhere except the disposable database at `127.0.0.1:55432/betgenius_feature_test`.

## Operational notes

- The daily cap defaults to 12, the timezone to Africa/Lagos, and kickoff reminders to 30 minutes. All three can be changed on `/notifications`. The daily cap limits interruptions, so it does not apply to publication and result history (see below).
- Quiet hours suppress push but still fill the inbox.
- Opening `/notifications` marks the notifications shown as read.
- Daily digests are live. See "Digest-first delivery".

## Digest-first delivery

Publication and result events are recorded in the inbox but never pushed on their own (`NEW_PREDICTION`, `RESULT_*`). Two daily digests carry that content instead. Both use the Africa/Lagos day:

| Digest | Created | Event key | Expires |
|---|---|---|---|
| Morning | Never before 09:00. From 09:00 to 09:30, only once 2+ categories are ready (`MORNING_EARLY_MIN_READY`; Bet of the Day counts as one). From 09:30, once any category or Bet of the Day is ready. From 10:00 (hard latest), any usable pick. Not created after 13:00. | `digest:morning:<day>` | 14:00 |
| Night | Summarises the **previous** Lagos day. Evaluated from 03:10 on each reminders run, after the 03:00 settlement run. Created once all of that day's picks have settled, or at least 90% of them (`NIGHT_SUBSTANTIAL_SETTLED_SHARE`). Otherwise it waits until the 03:30 cutoff, which creates "Results so far" with the unsettled count. Nothing is created if no pick has settled, or from 04:00. **Delivered from 07:00**, not when created (see below). | `digest:night:<summarised day>` | 12:00 the morning it is sent |

Why the night digest moved. It used to run from 23:00 to 23:55 on the day itself. Settlement runs every three hours (00:00, 03:00, … Lagos), so the evening fixtures were almost never settled in that window. On 22 Sep 2026, 0 of 89 picks had settled by 23:55. The digest was skipped, and nothing went back for that day. The 00:00 run settled 50 of the 89, and the 03:00 run brought it to 70. Under the current rule, the 22 Sep digest is created on 23 Sep at 03:30, as "Results so far" with 70 of 89 settled, and delivered at 07:00. The title names the day ("Results for Tue 22 Sep"), because it arrives the morning after. No new cron job was added, and the settlement schedule is unchanged. A digest that already exists for a day, including one made by the old evening window, is never repeated.

Delivery is held until 07:00 Lagos (`digestDeliverNotBefore`), so a recap created in the early hours never wakes anyone. Dispatch uses the same deferral as kickoff reminders: the delivery goes back to `RETRY` with `nextAttemptAt` set to 07:00. Nothing is written for the user before then, and no retry attempt is used up. At 07:00 the usual checks run: preferences, entitlement, the daily cap, and quiet hours. A user whose quiet hours cover 07:00 gets the inbox entry without a push, as with any other notification.

The morning digest names the categories that have picks, then Bet of the Day, then at most `TOP_MATCH_HIGHLIGHT_MAX` (3) top matches, drawn only from CORE competitions with SECONDARY filling any slots left. FALLBACK and DEEP_FALLBACK fixtures are never highlighted. Push and inbox copy are rendered per recipient, so paid selections appear only for entitled users and locked categories link to `/pricing`.

Who gets what:

| Preferences | Digest content |
|---|---|
| `editorialAlerts` on | the full global digest |
| `followedAlerts` on (plus `newPredictions` for the morning, `results` for the night), editorial off | only picks covered by the user's own team, league, category and prediction follows, matched by the same rules as the per-match alerts. Nothing relevant means no delivery. |
| both on | one combined digest: the global content plus a "Your follows" section |
| neither on | nothing |

There is one event per digest per day and one delivery per user per event, so nobody receives two morning or two night pushes. A paid pick on something a free reader follows is counted ("members-only"), never named.

These still push immediately: `KICKOFF_REMINDER`, `TIP_CHANGED`, `WITHDRAWN`, `MATCH_INSIGHT` and an explicitly selected `TOP_PREDICTION`. `EDITORIAL_DAILY_CAP` is clamped to 1–3.

A `TOP_PREDICTION` push also needs a strong competition (`topPredictionPushEligible`): CORE, or one of the SECONDARY top flights in `TOP_PREDICTION_PUSH_SECONDARY` (Portugal, Netherlands, Belgium, Turkey, Saudi Arabia, NPFL). FALLBACK, DEEP_FALLBACK, other SECONDARY and unknown leagues still reach the inbox but never push, and don't use up the editorial cap. Eligibility doesn't guarantee a push; the cap still applies. Bet of the Day and category content in the morning digest are unaffected.

The reminders job creates both digests (`createDailyDigests`), so no new schedule is needed. Its `JobRun` summary reports each digest's state.

The daily cap is counted per class (`dailyCapClass`):

| Class | Types | Limit |
|---|---|---|
| history | `NEW_PREDICTION`, `RESULT_*` | Not subject to `dailyCap`: it never rings, so it neither uses up the push allowance nor is blocked by it. It is bounded only by `INBOX_HISTORY_DAILY_CEILING`: 500 rows per user per day. That is system protection against a runaway bug, not a notification preference, and users cannot change it. Rows over it are skipped as `inbox history ceiling`, not `daily cap`. |
| inbox | `TOP_PREDICTION` outside every push-eligible competition | its own `dailyCap` allowance |
| push | digests, kickoff reminders, tip changes, withdrawals, insights, eligible top predictions | `dailyCap` (default 12), as before |

Before this change, history shared a `dailyCap`-sized inbox allowance. In the week to 24 Sep 2026, that skipped 326 publication and result rows and no push-class rows. Entitlement, preferences and the `userId_eventId` inbox key are unchanged. A paid pick never reaches a user who is not entitled to it.
