# Match Insights, Following, and Notifications

## Data and guarantees

Insights are calculated only by `src/lib/insights.ts` from cached API-Football fixtures. Eligible statuses are `FT`, `AET`, and `PEN`; API-Football's final goals are used (extra-time included for `AET`, shoot-out kicks excluded from the goals fields). Rows are deduplicated by provider fixture ID, ordered newest-first, filtered before the target cutoff, and scoped before the five-match minimum is applied. A streak is exact only when a preceding eligible result disproves it; otherwise the copy says "at least". Insight evidence expires six hours after its source cache refresh.

Following a paid category never grants access. Entitlement is rechecked when the feed is rendered and when a delivery is claimed. Push copy for VIP/Premium is deliberately generic and does not expose lock-screen selections.

## Environment

Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (normally a monitored `mailto:` URI). The private key is server-only. Existing `CRON_SECRET` bearer authentication protects every worker route.

If VAPID is absent, following and the in-site inbox remain available, dispatch completes without attempting push, and the test-push endpoint returns `503`. An unapplied schema is not supported: keep all feature routes and jobs disabled until the schema step below succeeds.

## Database rollout

This repository's established schema process is Prisma `db push`, guarded by `scripts/check-schema-sync.ts`; it has no migrations directory. Review the Prisma diff against a safe Preview/development Neon branch, apply with `npx prisma db push` there, rerun schema sync, and only then schedule deployment approval. This implementation does not run `db push` or modify production data.

Safe rollout order:

1. Create or select an isolated preview/development database and verify its host, database, and user.
2. Apply `npx prisma db push` to that database and run `npm run check:schema`.
3. Configure `CRON_SECRET`; configure all three VAPID values together if browser push is being enabled.
4. Deploy the application with scheduler jobs still disabled.
5. Run one authenticated `GET /api/admin/refresh-insights?limit=25`, then verify the public insights and synthetic follow/inbox flow.
6. Enable reminders, dispatch, and refresh schedules only after the preceding checks pass.

Rollback is application-first: disable the three jobs, roll back the application, then leave the additive tables/columns in place until a separately reviewed cleanup. Do not drop notification data while either application version or a worker may still reference it.

## Scheduler configuration

Configure cron-job.org with GET, `Authorization: Bearer <CRON_SECRET>`, and Africa/Lagos timezone:

- `/api/admin/refresh-insights?limit=25` at `8,23,38,53 * * * *`.
- `/api/admin/notifications/reminders` every five minutes: `*/5 * * * *`.
- `/api/admin/notifications/dispatch` every two minutes: `*/2 * * * *`.

The reminders worker creates expiring idempotent events; dispatch fans out follows, claims at most 50 deliveries with a 60-second lease, retries with exponential backoff up to five attempts, removes 404/410 push endpoints, records terminal failures, and writes `JobRun` summaries. External push is at-least-once: event/delivery keys and service-worker notification tags minimise visible duplicates but cannot guarantee exactly-once receipt.

The two-minute interval is safe to overlap: workers claim rows with unique lease tokens, conditional updates prevent double claims, and expired leases are recoverable. All scheduler endpoints accept `GET` only and require the bearer secret. Insight refresh reads cached fixture history and therefore adds zero API-Football calls per scheduled run or retry; its database workload is bounded by `limit=25` and rotates through eligible teams.

## Operational notes

Run insights only after team enrichment. Do not call the football API from public requests. The daily cap defaults to 12, timezone to Africa/Lagos, and kickoff reminders to 30 minutes. Quiet hours suppress push while retaining the in-site inbox. The current release omits the optional daily digest.
