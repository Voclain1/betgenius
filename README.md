# BetGenius

Full-stack football tips & predictions site built with **Next.js 14 (App Router)**, **Prisma**, **NextAuth**,
**Tailwind**, **API-Football**, **Anthropic Claude**, and **Paystack**.

## What's inside

### Public site (`/`)
- **Home** with featured tips and section cards
- **Predictions** — six gated categories: `featured`, `genius`, `today`, `banker`, `vip`, `premium`
- **Livescores** — auto-refreshing in-play scores (API-Football)
- **Fixtures** — day view, grouped by league
- **Standings** — sortable table for the majors (EPL, La Liga, Serie A, Bundesliga, Ligue 1, UCL)
- **Bet builder** — accumulator calculator; POST `/api/betslip` persists it for logged-in users
- **StatsPad** — top attack / defence / form / GD lists per league
- **Pricing** — VIP + Premium tiers via Paystack
- **Login / Register** — email + password (bcrypt)

### Subscriptions
- Free users see Featured, Genius, Today, Banker.
- **VIP** unlocks the VIP category. **Premium** unlocks VIP + Premium.
- Paystack checkout redirects to `/dashboard?paid=1`; the webhook flips the sub to `ACTIVE`.

### Admin dashboard (`/admin`)
- **Overview** stats
- **AI panel** — enter a fixture + IDs, Claude generates a match preview and pick candidates using API-Football form/injuries/standings context. Candidates are saved as `PENDING_REVIEW` predictions. Approve → Publish → live on the public site.
- **Predictions** — table with Approve / Publish / Archive.
- **Subscribers** — approve pending subs, change tier, cancel.
- **Admins** — SUPER_ADMIN can nominate users to `ADMIN_PENDING` and approve them to `ADMIN`.
- **Tasks** — kanban with assignment + due dates.

## Setup

```bash
cd betgenius
cp .env.example .env      # fill in the values you need
npm install
npm run db:push           # creates SQLite dev.db
npm run db:seed           # creates the super admin
npm run dev
```

Open `http://localhost:3000` and log in with the `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env`.

### Environment variables

| Var | Where to get it |
| --- | --- |
| `DATABASE_URL` | SQLite by default. Swap `datasource db` in `prisma/schema.prisma` to `postgresql` for prod. |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `API_FOOTBALL_KEY` / `API_FOOTBALL_HOST` | https://www.api-football.com/documentation-v3 |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | https://console.anthropic.com |
| `PAYSTACK_PUBLIC_KEY` / `PAYSTACK_SECRET_KEY` | https://dashboard.paystack.com/#/settings/developer |
| `PAYSTACK_PLAN_VIP` / `PAYSTACK_PLAN_PREMIUM` | Create plans in Paystack, paste their plan codes (currently unused — see below) |

> **Checkout is one-time, not recurring, for now.** This Paystack integration has
> no active recurring-capable channel, so a plan checkout resolves to zero
> available channels. `PAYSTACK_PLAN_*` is kept configured and unused; see the
> comment at the top of `src/app/api/subscription/initialize/route.ts` for how to
> restore recurring billing.

### Paystack webhook
Point Paystack's webhook to `https://<your-domain>/api/subscription/webhook`. Signature is verified with your secret key (HMAC-SHA512).

### Diagnosing failed payments
`/admin/payments` records and classifies every checkout attempt. See
[docs/PAYMENTS_OBSERVABILITY.md](docs/PAYMENTS_OBSERVABILITY.md) — in particular
why a fraud block and a bank decline need different people to act.

## Category access matrix

| Category | FREE | VIP | PREMIUM | ADMIN |
|---|:-:|:-:|:-:|:-:|
| Featured / Genius / Today / Banker | ✓ | ✓ | ✓ | ✓ |
| VIP | 🔒 | ✓ | ✓ | ✓ |
| Premium | 🔒 | 🔒 | ✓ | ✓ |

Locked cards render with `pick=LOCKED` and a subscribe CTA. See `src/lib/access.ts`.

## AI accuracy — read this

The brief asked for "99% accurate" predictions. **No model can guarantee that**, and no honest prediction site should imply it. What this build actually does:

- The Claude system prompt forbids invented players, transfers, or scores; it must reason only over the data we pass it.
- Confidence is **capped at 90** in the prompt to prevent overclaim.
- API-Football supplies real team form, injuries, last-5 fixtures, and standings that get injected into the prompt.
- The AI panel produces **drafts** — nothing goes live until an admin approves and publishes.
- The admin AI page has a visible disclaimer to the same effect.

If you want higher accuracy, wire in more signals (xG providers, weather, ref stats) and blend Claude with a domain model. Do not ship a "99%" claim to end users.

## Deploy

- Vercel (recommended). Set env vars, provision a Postgres DB (Neon/Supabase), switch `datasource db` provider to `postgresql`, run `prisma migrate deploy`.
- Set the Paystack webhook to the deployed URL.
- Optional: add rate limiting to `/api/admin/ai` since Claude calls are billable.

## Notable files

```
src/
  app/
    (public)/…          public site
    admin/…             admin dashboard
    api/…               route handlers
  lib/
    auth.ts             NextAuth config
    access.ts           tier + role gating
    prisma.ts           Prisma singleton
    football/api-football.ts
    ai/claude.ts        Claude prompt + JSON parse
    paystack/paystack.ts
    paystack/verifySignature.ts
  components/           Nav, PredictionCard, Providers
prisma/
  schema.prisma
  seed.ts
```
