# Preflight

Checks come in three tiers. The runner (`scripts/preflight.ts`) enforces each tier's limits; nothing depends on convention. The step lists are in `scripts/lib/preflightSteps.ts`, and `scripts/check-db-safety.ts` pins the split.

| Command | Database | Network | When to run |
|---|---|---|---|
| `npm run preflight` | none | blocked | always: locally, in CI, before every commit |
| `npm run preflight:db` | the configured database, read-only | blocked | to verify the live schema and data shape |
| `npm run preflight:integration` | a separate, disposable database | blocked | when changing code the integration checks cover |

## `npm run preflight`

Pure and deterministic checks, plus `tsc --noEmit`. It is safe even when `.env` points at Production:

- `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are replaced with an address under `.invalid`, which never resolves. A variable set explicitly takes precedence over `.env` in Prisma, so no check can reach any database.
- Every check is started with `scripts/lib/preflight-network-guard.mjs` preloaded. Any `fetch` to a host that isn't loopback is rejected.
- `API_FOOTBALL_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `PAYSTACK_SECRET_KEY` and `VAPID_PRIVATE_KEY` are blanked.

A check belongs here only if it passes under those conditions. Checks that need data use in-memory stubs of the Prisma methods they call (see `check-notification-digest.ts` and `check-inbox-history-cap.ts`).

## `npm run preflight:db`

Read-only checks against the configured database:

- `check-schema-sync`: the live schema matches `prisma/schema.prisma`.
- `check-feed-days`: the category feeds query the right Lagos days.
- `check-prediction-slugs`: every published row's slug keys match `src/lib/slug.ts`.

The connection strings get `options=-c default_transaction_read_only=on`, so Postgres rejects any `INSERT`, `UPDATE` or `DELETE` on the session, whatever a script attempts. The runner confirms `SHOW transaction_read_only` returns `on` before running anything. If it can't confirm that, it refuses to run.

These checks are kept out of `npm run preflight` so that ordinary CI does not depend on live Production state.

## `npm run preflight:integration`

These checks insert their own rows and delete them afterwards:

- `check-tier-provenance`
- `check-vip-premium-gate` (it also upserts `FixtureOddsCache` rows)
- `check-betofday-targeting` (it also upserts `FixtureOddsCache` rows)

They never run against Production. The repository holds no fingerprint of any real database, not even a hash. Every comparison is made at runtime, against the database identities the machine running the checks actually has.

Before connecting, the runner refuses to start unless all of these hold:

1. `BETGENIUS_DB_INTEGRATION=1` is set, as an explicit opt-in. `NODE_ENV` plays no part in the decision.
2. `INTEGRATION_DATABASE_URL` names the target. It must be supplied separately from the normal database variables. The runner passes it to the checks as `DATABASE_URL`.
3. `BETGENIUS_DB_INTEGRATION_HOST` equals the hostname in `INTEGRATION_DATABASE_URL` exactly. This is a typed identity check.
4. The target differs from every normal database identity available at runtime:
   - the URL variables `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DIRECT_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING` and `POSTGRES_URL_NO_SSL`;
   - the host variables `PGHOST`, `PGHOST_UNPOOLED` and `POSTGRES_HOST`;
   - each of these as the runner was started with it, and as written in `.env` and `.env.local`.

   Before pointing `DATABASE_URL` at the target, the runner copies the originals to `BETGENIUS_REFERENCE_<NAME>`. Hosts are compared on the Neon endpoint too, so a pooled and a direct host of the same database count as the same.
5. At least one normal identity must be available. If there is none (no env files and none in the environment), the run is refused rather than allowed. On such a machine, set `BETGENIUS_REFERENCE_DATABASE_URL` or `BETGENIUS_REFERENCE_DATABASE_HOST` to the non-test database. A normal identity that can't be parsed also refuses the run.

It then connects read-only and refuses if `JobRun` has any row from the last 6 hours. The live scheduler writes one every few minutes, so recent rows mean the database is serving real traffic. A fresh database without the table passes this probe, and any other failure to probe refuses.

Each of the three checks also calls `assertIntegrationDatabase()` before loading Prisma. Running one directly, for example with `npm run check:vip-premium`, fails closed in the same way.

Example against a disposable Neon branch:

```sh
BETGENIUS_DB_INTEGRATION=1 \
INTEGRATION_DATABASE_URL='postgresql://…@ep-test-branch-123456.eu-central-1.aws.neon.tech/betgenius?sslmode=require' \
BETGENIUS_DB_INTEGRATION_HOST=ep-test-branch-123456.eu-central-1.aws.neon.tech \
npm run preflight:integration
```

Run this from the usual checkout, where `.env` names the normal database, so the guard has an identity to compare against. `scripts/check-db-safety.ts` tests every refusal offline, using made-up hosts and an injected activity probe. It also checks that no hash or digest literal, and no local database identity, appears in the safety files.

## Scripts outside the tiers

The `verify-*` scripts guard themselves: they run only against `127.0.0.1:55432/betgenius_feature_test`. Several other `check-*`, `research-*` and `measure-*` scripts read or write the live database and are not in any tier. Examples are `check-bet-of-the-day*`, `check-doubles-quota`, `check-double-settlement`, `check-market-confirmed-curation` and `check-combo-date-gating`. Run them deliberately, never as part of a routine check. Before adding any of them to a tier, apply the rules above.
