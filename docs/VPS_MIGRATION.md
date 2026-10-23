# Moving to a Contabo VPS — the plan

Status: **repo side built (21 Oct 2026), nothing live yet.** Decided Oct 2026:
move *everything* (app and database) to a Contabo VPS in Germany, mainly to cut
cost, on a 9-day timeline alongside School Kit. The image, server files and
workflows below exist and were tested locally (image build against Postgres 17,
health, pages, image optimiser, backup and restore); they have not run against
a real server. Vercel and Neon are untouched until the cutover in §6.

Everything below is designed to be driven from GitHub Actions, so it can be run
from a phone: no terminal on the owner's side.

## 1. What moves where

| Today | On the VPS |
|---|---|
| Vercel: Next.js app, API routes, image optimisation | Next.js `standalone` build in Docker (Node 20), with `sharp` for images |
| Neon: Postgres (pooled + direct URLs) | Postgres 17 in Docker on the same VPS, data on a named volume |
| Vercel's HTTPS and CDN | Caddy (automatic Let's Encrypt), with Cloudflare in front (see §3) |
| `vercel.json` crons: `/api/admin/settle` 06:00 UTC, `/api/admin/curate-accumulators` 10:30 UTC | A cron container (or host crontab) calling the same URLs with `Authorization: Bearer $CRON_SECRET` |
| cron-job.org pokes (generation, VIP pass, discovery, insights, settle 3-hourly…) | **Unchanged.** They call the domain, which will point at the VPS |
| GitHub Actions: preflight, diagnose-generation | Unchanged; `diagnose-generation` points at the new `DATABASE_URL` secret |
| Vercel preview deployments | Gone (see §8) |

External services do not change: Paystack, API-Football, Gemini/Groq, Resend,
Google sign-in, web push (VAPID). Paystack's webhook URL and Google's authorised
origins use the domain, so they keep working after the DNS switch.

## 2. The server

- **Contabo Cloud VPS, Germany**, at least **6 vCPU / 12 GB RAM / NVMe**.
  Postgres, the Next.js server and a build are comfortable there, with headroom
  for a background generation worker later. Check Contabo's current price list
  when ordering; prices are not recorded here because they change.
- Ubuntu 24.04 LTS. Order with an **SSH key**, not a password.
- Add **Contabo Object Storage** (or Backblaze B2) for off-server backups.

## 3. DNS: move it to Cloudflare first

DNS is on Vercel today. Leaving Vercel hosting while keeping its DNS works, but it
ties the domain to the platform being left. Recommended, as a first step, a week
before the move:

1. Create a free Cloudflare account and add `betgenius.ng`. Cloudflare imports
   the existing records.
2. Check every record matches: the site, `www`, `ads.`, and every mail record
   (Resend's sending records and any MX, SPF, DKIM and DMARC). **Mail records must
   come across exactly.**
3. Change the nameservers at the registrar to Cloudflare's. Nothing else
   changes; the site still points at Vercel.
4. Lower the TTL on the site records to 5 minutes.

Benefits for this move:
- **Cutover is one record change, with instant rollback.**
- **Cloudflare's proxy caches pages close to readers,** including a Lagos
  location. That gives back the speed Contabo's lack of an African data centre
  would otherwise cost.
- **DDoS protection,** which a single VPS has none of on its own.

## 4. What is in the repo

| File | What it does |
|---|---|
| `Dockerfile` | Multi-stage build to a `standalone` Next.js server on Node 20, with `sharp` for `next/image`. `NEXT_PUBLIC_*` are build arguments. Sets `APP_ENV=production` (MetaPixel reads it where it used to read only Vercel's `VERCEL_ENV`) and `APP_BUILD_ID` (the sitemap cache key, `sitemapCache.ts`). |
| `src/app/api/health/route.ts` | 200 when the app and the database answer. Used by the deploy and an uptime monitor. |
| `deploy/docker-compose.yml` | `app`, `postgres` (17), `caddy`, `ops`. Postgres and the app listen on 127.0.0.1 only. |
| `deploy/Caddyfile` | HTTPS for `SITE_DOMAIN`, `www.` redirects to it. |
| `deploy/ops/` | Cron (the two `vercel.json` jobs, same times, with the `CRON_SECRET` bearer) and the nightly backup to object storage: 14 daily and 8 weekly copies, plus `restore-test.sh`. |
| `deploy/server-setup.sh` | Docker, a `deploy` user, SSH keys only, firewall 22/80/443, unattended upgrades, fail2ban, swap. |
| `deploy/deploy.sh` | Switches to a new image, waits for `/api/health`, rolls back to the previous image if it never turns 200. |
| `.github/workflows/vps-setup.yml` | Runs `server-setup.sh` once, as root. |
| `.github/workflows/deploy-vps.yml` | Build, push to GHCR, ship settings, switch. On every push to `master` once `VPS_DEPLOY_ENABLED=true`. |
| `.github/workflows/vps-db-copy.yml` | Neon to VPS copy (type `REPLACE`), then compares row counts. |
| `.github/workflows/db-restore-test.yml` | Monthly restore of the latest backup into a scratch database. |
| `.github/actions/vps-db-tunnel` | When `DB_ON_VPS=true`, `db-push`, `preflight` and `diagnose-generation` reach the VPS database through SSH. |

**The build needs the database**, exactly as on Vercel: six pages
(`/fixtures`, `/track-record`, …) are rendered from data at build time, and
`check-schema-sync` refuses a build whose schema the database lacks. The
deploy passes `DATABASE_URL`/`DATABASE_URL_UNPOOLED` as build secrets (never
stored in the image): Neon's before cutover, the tunnel after.

### Settings to add on GitHub (Settings → Secrets and variables → Actions)

| Name | Kind | Value |
|---|---|---|
| `VPS_HOST` | secret | The server's IP address |
| `VPS_SSH_KEY` | secret | The private half of the key the server was ordered with |
| `PROD_ENV_FILE` | secret | The production settings, one `NAME=value` per line, as on Vercel today (`vercel env pull` gives them). Any `DATABASE_URL` lines in it are ignored on the server |
| `POSTGRES_PASSWORD` | secret | `openssl rand -hex 24` (letters and digits only, it goes in a URL) |
| `OPS_ENV_FILE` | secret | `CRON_SECRET=…` (same as in `PROD_ENV_FILE`), `BACKUP_BUCKET=<bucket>`, `RCLONE_CONFIG_BACKUP_TYPE=s3`, `RCLONE_CONFIG_BACKUP_PROVIDER=Other`, `RCLONE_CONFIG_BACKUP_ENDPOINT=<object storage URL>`, `RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID=…`, `RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=…`, optionally `HEALTHCHECK_PING_URL=…` (healthchecks.io, alerts when a backup does not run) |
| `NEON_DIRECT_URL` | secret | Neon's direct (non-pooler) URL, for `vps-db-copy` |
| `SITE_DOMAIN` | variable | `vps.betgenius.ng` for the rehearsal, `betgenius.ng` at cutover |
| `VPS_DEPLOY_ENABLED` | variable | `true` to deploy on every push to `master` |
| `DB_ON_VPS` | variable | `true` at cutover, together with pointing the `DATABASE_URL` and `DATABASE_URL_UNPOOLED` secrets at `postgresql://betgenius:<POSTGRES_PASSWORD>@127.0.0.1:5432/betgenius` |

## 5. Rehearsal (live site untouched)

1. Add `vps.betgenius.ng` in Cloudflare pointing at the VPS IP, then run
   `vps-setup`.
2. Run `deploy-vps` by hand (first run: the app starts on an empty database).
3. Run `vps-db-copy` (type `REPLACE`). The app on `vps.betgenius.ng` now
   serves a copy of production.
4. Check:
   - login and Google sign-in;
   - a test payment on Paystack test keys;
   - push notifications;
   - generation, the VIP pass and settlement, poked by hand;
   - `npm run preflight:db` against the VPS;
   - `diagnose-generation` against the VPS.
5. Fix whatever the rehearsal finds. Repeat until it is boring.

## 6. Cutover (about 15 minutes, a quiet hour, e.g. 04:00 Lagos)

1. Pause the cron-job.org jobs and disable the Vercel crons.
2. Put the Vercel site into maintenance (or just accept ~10 minutes of read-only
   risk at a quiet hour).
3. Run `vps-db-copy` (type `REPLACE`); it compares the row counts.
4. Set `SITE_DOMAIN=betgenius.ng`, `DB_ON_VPS=true`, the two `DATABASE_URL`
   secrets (§4), `VPS_DEPLOY_ENABLED=true`; run `deploy-vps`.
5. Change the Cloudflare A records (`@` and `www`) to the VPS IP.
6. Smoke test the live domain: homepage, login, a paid feed, the admin page,
   `/api/admin/jobs`, `/api/health`.
7. Resume the cron-job.org jobs. Run `diagnose-generation` an hour later.
8. Disconnect the Vercel project from GitHub, so a push no longer deploys a
   Vercel copy still wired to Neon.

## 7. Rollback

- Keep Vercel and Neon running, untouched, for **7 days**.
- Rollback = point the Cloudflare A record back at Vercel. Anything written on
  the VPS after cutover (new picks, payments) would need copying back. Payments
  are reconcilable from Paystack (`scripts/reconcile-payments.ts`).
- After 7 clean days: export a final Neon backup to object storage, then cancel
  Neon and downgrade Vercel.

## 8. What is lost, and what replaces it

| Lost | Replacement |
|---|---|
| Neon's automatic backups and point-in-time restore | Nightly off-server dumps plus a monthly restore test (§4). Worst case loses up to a day; add WAL archiving later if that is too much |
| Platform redundancy | One server: if it is down, the site is down. Cloudflare's "always online" covers cached pages. Contabo snapshots before every risky change |
| Preview deployments per PR | Optional: keep a free Vercel project for previews only, pointed at a *copy* of the database, never production |
| Zero-maintenance hosting | Unattended security upgrades and an uptime monitor (e.g. UptimeRobot, free) that alerts by email |

## 9. Later, once on the VPS

Vercel's 30-second limit is why a generation run handles 1–2 fixtures and why
cron-job.org pokes every 15 minutes. On the VPS, generation can become a
long-running worker (a fourth container) that works through the queue
continuously. That gives faster coverage and fewer moving parts. It is a separate
change, after the move has been stable for a while.
