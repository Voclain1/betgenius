# Match Insights, Following, and Notifications

## Data and guarantees

Insights are calculated only by `src/lib/insights.ts` from cached API-Football fixtures. Eligible statuses are `FT`, `AET`, and `PEN`; API-Football's final goals are used (extra-time included for `AET`, shoot-out kicks excluded from the goals fields). Rows are deduplicated by provider fixture ID, ordered newest-first, filtered before the target cutoff, and scoped before the five-match minimum is applied. A streak is exact only when a preceding eligible result disproves it; otherwise the copy says "at least". Insight evidence expires six hours after its source cache refresh.

Following a paid category never grants access. Entitlement is rechecked when the feed is rendered and when a delivery is claimed. Push copy for VIP/Premium is deliberately generic and does not expose lock-screen selections.

## Environment

Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (normally a monitored `mailto:` URI). The private key is server-only. Existing `CRON_SECRET` bearer authentication protects every worker route.

## Database rollout

This repository's established schema process is Prisma `db push`, guarded by `scripts/check-schema-sync.ts`; it has no migrations directory. Review the Prisma diff against a safe Preview/development Neon branch, apply with `npx prisma db push` there, rerun schema sync, and only then schedule deployment approval. This implementation does not run `db push` or modify production data.

## Scheduler configuration

Configure cron-job.org with GET, `Authorization: Bearer <CRON_SECRET>`, and Africa/Lagos timezone:

- `/api/admin/refresh-insights?limit=25` at `8,23,38,53 * * * *`.
- `/api/admin/notifications/reminders` every five minutes: `*/5 * * * *`.
- `/api/admin/notifications/dispatch` every two minutes: `*/2 * * * *`.

The reminders worker creates expiring idempotent events; dispatch fans out follows, claims at most 50 deliveries with a 60-second lease, retries with exponential backoff up to five attempts, removes 404/410 push endpoints, records terminal failures, and writes `JobRun` summaries. External push is at-least-once: event/delivery keys and service-worker notification tags minimise visible duplicates but cannot guarantee exactly-once receipt.

## Operational notes

Run insights only after team enrichment. Do not call the football API from public requests. The daily cap defaults to 12, timezone to Africa/Lagos, and kickoff reminders to 30 minutes. Quiet hours suppress push while retaining the in-site inbox. The current release omits the optional daily digest.
