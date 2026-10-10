# Moving to a Contabo VPS — the plan

Status: **planned, not started.** Decided Oct 2026: move *everything* (app and
database) to one Contabo VPS in Germany, mainly to cut cost. Do it once the
current feature work settles. Nothing in this document has been built yet; the
"Repo changes" section lists what has to be written first.

Everything below is designed to be driven from GitHub Actions, so it can be run
from a phone: no terminal on the owner's side.

## 1. What moves where

| Today | On the VPS |
|---|---|
| Vercel: Next.js app, API routes, image optimisation | Next.js `standalone` build in Docker (Node 20), with `sharp` for images |
| Neon: Postgres (pooled + direct URLs) | Postgres 16 in Docker on the same VPS, data on a named volume |
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

## 4. Repo changes to make first (one PR, nothing live)

1. **`next.config.mjs`**: add `output: "standalone"`.
2. **`sharp`**: add it as a dependency, for `next/image` optimisation off Vercel.
3. **`src/lib/sitemapCache.ts`**: `sitemapCacheDeployment` must also read a
   self-hosted build id (e.g. `APP_BUILD_ID`, set to the git SHA at build time).
   Today it falls back to the constant `"local"` off Vercel, so a new deploy could
   keep serving the previous deploy's sitemap.
4. **`Dockerfile`**: a multi-stage build (deps, then `prisma generate` and
   `next build`, then a slim runner).
5. **`deploy/docker-compose.yml`**: `app`, `postgres`, `caddy`, `cron`. Postgres
   is not exposed to the internet, only to the app on the internal network.
6. **`deploy/Caddyfile`**: the domain, HTTPS, and `X-Forwarded-*` headers so the
   app sees real client IPs.
7. **`deploy/backup.sh`**: a nightly `pg_dump -Fc`, uploaded to object storage.
   Keep 14 daily and 8 weekly copies.
8. **GitHub Actions**, all over SSH using two repo secrets: `VPS_HOST` and
   `VPS_SSH_KEY`.
   - `vps-setup.yml` (run once): Docker, firewall (only 22/80/443; SSH key-only,
     no root password), unattended security upgrades, fail2ban, backup timer.
   - `deploy.yml` (on every merge to `master`): build the image, ship it,
     `prisma migrate`/schema check, restart with a health check, keep the
     previous image for a one-command rollback.
   - `db-restore-test.yml` (monthly): restore the latest backup into a scratch
     database and count rows. A backup that has never been restored is not a
     backup.
9. **Env file template**: the 30 variables in `.env.example`, stored as a GitHub
   secret and written to the server by `deploy.yml`. `DATABASE_URL` and
   `DATABASE_URL_UNPOOLED` both point at the local Postgres (no pooler needed).
   `NEXTAUTH_URL` stays the public domain.

## 5. Rehearsal (live site untouched)

1. Run `vps-setup.yml`.
2. Copy Neon to the VPS (`pg_dump` from Neon's direct URL, `pg_restore` into
   the VPS), via a workflow.
3. Deploy the app pointed at the VPS database, reachable on a temporary hostname
   (e.g. `vps.betgenius.ng`).
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
3. Take a final `pg_dump` from Neon and restore it on the VPS. Compare row
   counts for `Prediction`, `User`, `Subscription` and `PaymentAttempt`.
4. Change the Cloudflare A record to the VPS IP.
5. Smoke test the live domain: homepage, login, a paid feed, the admin page,
   `/api/admin/jobs`.
6. Resume the cron-job.org jobs. Run `diagnose-generation` an hour later.

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
