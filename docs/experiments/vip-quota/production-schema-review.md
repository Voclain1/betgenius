# PR #202 production schema review

Reviewed on 15 November 2026. Master remains `35015264` (#201), an ancestor of PR implementation `7c1374b`. PR #202 remains draft. **After subsequent explicit owner approval and successful isolated backup recovery, the exact hash-bound additive schema operation was applied. No app deployment, merge or experiment enablement occurred.**

Current operational follow-up: [backup repair, isolated recovery and schema outcome](backup-recovery-resolution.md). This supersedes the earlier [blocked operational investigation](operational-safety-check.md).

## Verdict and exact plan

**Strictly additive and backward-compatible.** The entire schema difference is a new `PaidQuotaAttempt` table, its primary key on `fixtureApiId`, and two ordinary B-tree indexes on `spendDay` and `kickoffDay`. There are no foreign keys, triggers, changes to existing relations, data backfills, updates, renames, drops or type changes. Required fields/defaults apply only to the new, initially empty table. The primary key cannot invalidate any existing production rows.

The reviewed SQL statements are in [production-schema.sql](production-schema.sql), generated with the lockfile's Prisma 5.22.0 from master to the PR datamodel. Identical raw CLI plans were produced against populated disposable databases on PostgreSQL 16 and **17** (the major version in `deploy/docker-compose.yml`). The approval hash below covers raw CLI `plan.sql`, including Prisma's terminal blank line; the reference SQL file omits that extra blank line for repository formatting.

```
SHA-256(plan.sql): 99ee9f0cc4270ca7dbec0842c215545c9023146e8be3335769a1c3795eea15b6
```

This SQL file is a review artifact. Use the established workflow below, not an ad hoc SQL deployment.

## Preflight and existing CI

[Preflight 43704466401](https://github.com/Voclain1/betgenius/actions/runs/43704466401) fails at **Schema matches the live database**: production lacks `PaidQuotaAttempt`, `PaidQuotaAttempt_spendDay_idx` and `PaidQuotaAttempt_kickoffDay_idx`. The primary key is part of the table definition. The printed diff contains only those three CREATE statements.

This is the **only recorded failure**, not proof that every downstream production check will pass. Typecheck, competition grounding, match evidence, lineup/odds coverage, header/browser checks, build and performance budgets were skipped after schema-sync failed. They must run through the actual PR preflight again after the approved schema application.

On the implementation head, all nine other GitHub checks completed successfully, including discovery, experiment, paid unit, PostgreSQL publication, alternative markets, league coverage, operations, reliability and forecasting. In this review, the skipped checks were also run locally against the rehearsed schema; results are below. No CI check or schema-sync policy was bypassed.

## Established production mechanism

The project's procedure is **`prisma db push`**, not `prisma migrate deploy` or `migrate dev`: see `.github/workflows/db-push.yml` and `docs/MATCH_INSIGHTS_NOTIFICATIONS.md` (Database rollout). Successful prior manual use includes [43402629434](https://github.com/Voclain1/betgenius/actions/runs/43402629434), 13 November.

`db-push` is manual-only, serializes runs with concurrency group `db-push`, checks out the selected branch, installs the locked dependencies, prints a fresh `prisma migrate diff` plan, rejects destructive SQL, runs `npx prisma db push --skip-generate` without `--accept-data-loss`, then runs `npm run check:schema`. It does not merge, build/deploy an app, change runtime flags or restart production services.

It uses the repository's existing `DATABASE_URL` / `DATABASE_URL_UNPOOLED` secrets. When `DB_ON_VPS=true`, the existing SSH action forwards runner localhost:5432 to VPS localhost:5433. Otherwise it uses the existing configured database endpoint. Confirm the intended target identity before approval; no credentials should be copied into a report or command line.

This review adds one optional workflow input, `expected_plan_sha256`. It compares the newly introspected plan to the approved hash **before Push**, in addition to the existing destructive-change guard. A changed plan—including unexpected additive changes or a partially/already applied plan—stops for review. Omitting the input preserves the existing manual workflow behavior. No automatic trigger was added.

## Exact operation requiring explicit approval

Authorize **only** dispatching `db-push.yml` on the reviewed PR branch/revision, using the existing production database secrets, with this plan hash:

```sh
gh workflow run db-push.yml \
  --repo Voclain1/betgenius \
  --ref codex/vip-controlled-quota \
  -f expected_plan_sha256=99ee9f0cc4270ca7dbec0842c215545c9023146e8be3335769a1c3795eea15b6
```

**Prepared, not executed.** Freeze/check the branch at the reviewed revision before dispatch. The production write is exactly `npx prisma db push --skip-generate`, gated on the three-statement plan above. Keep unrelated schema changes out of the maintenance window: the workflow serializes its own runs, but does not prevent external/manual DDL between planning and application. If the hash differs, do not omit the guard or accept data loss; inspect a fresh read-only diff and obtain approval for any revised scope.

## Risks, deployment sequence and rollback

1. Verify recent production backup availability and recovery health. The latest visible scheduled [restore test 41300649446](https://github.com/Voclain1/betgenius/actions/runs/41300649446), 1 November, failed at the restore-script step (exit 1). Available logs do not establish the cause or current backup freshness. This does not imply this additive plan deletes data, but recovery readiness must not be represented as verified.
2. Confirm production targets, absence of concurrent DDL, and that `VIP_QUOTA_EXPERIMENT` is unset/`off` in the eventual app environment. Runtime configuration was not changed/read from write-only secrets. Repository Actions-variable inspection returned HTTP 403, so current `VPS_DEPLOY_ENABLED` cannot be attested here. **Treat merging as potentially deploying automatically:** `deploy-vps.yml` deploys on master pushes when that variable is `true`.
3. Obtain explicit **schema-only** approval, then dispatch the guarded workflow above while PR #202 stays draft and the old app remains running. Ordinary index creation locks only the new relation and scans no existing business table. Catalog/concurrent-DDL contention is still possible; this workflow has no custom lock timeout. Stop and inspect unexpected blocking rather than weakening checks.
4. Verify workflow success, live schema-sync and that the new table is empty. If a command fails part-way, retain any created objects, inspect the residual diff and seek approval for the revised plan/hash; do not assume all DDL was rolled back. Do not reset or drop tables as a retry strategy.
5. Rerun the **latest PR #202 preflight run**, including all previously skipped steps. Keep the PR in draft until checks and review complete. Schema approval does not authorize merging or deploying. If merge triggers automatic deployment, future approval must cover that deployment too, or an operator must separately approve pausing that trigger beforehand.
6. Only after separate merge/deployment approval, build/deploy the reviewed application with the experiment unset/`off`. Check baseline eight-attempt behavior, the unchanged 12-call daily cap, existing gates and API budget. This task changes no confidence floor, EV rule, quota value, API budget or provider route. Do not supply experimental funding/price controls or enable extra attempts as part of schema resolution.
7. **Rollback:** after schema-only application, the old app can keep running with the extra table present. No reverse DDL is needed. After any separately approved application deployment, use the established application/image rollback procedure and leave `PaidQuotaAttempt`, its indexes and any audit rows intact. Do not run an old schema's `db push` to “undo” the table: that would propose a DROP. Do not delete reservations or published/settled evidence. Any eventual schema cleanup requires separate review/approval.

## Rehearsal and rerun results

- Generated plan is exactly the SQL above on PostgreSQL 16 and 17. Application through `db push --skip-generate` succeeded; PR schema-sync passed; repeat application was a no-op on PostgreSQL 16.
- Before/after fingerprints of **all 42 existing tables**, their data, columns, index definitions and constraints were identical on both PostgreSQL versions. Five representative existing rows covered a user, a model job, a published prediction, its VIP category and API usage. No production data was copied or touched.
- Master schema-sync against the additive PostgreSQL 16 database returned only its expected “database ahead” warning with exit 0. The reverse diff proposes only `DROP TABLE PaidQuotaAttempt`; that diff was inspected, never applied.
- Actual workflow Plan shell tested locally: exact/uppercase approved hash accepted; wrong/malformed hash, unapproved additive drift, destructive SQL and stale approval against an empty plan rejected; omitted input retained existing behavior. The real PostgreSQL 17 plan passed the new hash guard before local application. Workflow YAML parses and its write command is unchanged.
- Seventeen applicable standalone checks passed: experiment config/cost isolation, overlay (**248**), quota (**23**), spare quota (**64**), paid selection (**75**), qualification (**72**), European lane (**110**), alternative market (**70**), paid value integration (**55**), kickoff, generation failures, bulk dedupe, providers (**54**), generation (**138**), Sprint 11 (**70**), supply funnel (**18**), competition grounding. All eight paid market-quality component suites passed. TypeScript passed.
- Fresh disposable PostgreSQL experiment concurrency/cost/API/disable/publication checks and the existing atomic publication/quote/notification/rollback checks passed.
- Preflight's match-evidence and lineup/odds rendering checks passed. Chromium header checks passed at all seven widths in signed-out, signed-in and admin states. `next build` completed against disposable PostgreSQL with the experiment off and provider keys empty; all **76** measured pages passed the performance budgets.

**Readiness:** the additive schema approval package is prepared, but the subsequent [operational check](operational-safety-check.md) found a backup-destination DNS blocker. A safe schema-only operation is **not cleared** until backup freshness and isolated recovery are demonstrated. Merge/deployment also remain unapproved and require a successful real preflight rerun. The experiment remains disabled by default, and the reviewed SQL hash guard is unchanged.
