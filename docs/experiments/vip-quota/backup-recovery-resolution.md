# Backup recovery resolution — 15 November 2026

Times below are Lagos (UTC+1); underlying workflow logs use UTC.

## Verified cause and correction

BetGenius's `ops.env`, running container and cron environment contained the same
unparseable R2 endpoint template and an incorrectly formatted S3 secret. Control
DNS resolved normally. This was a storage configuration failure, not evidence of
a corrupt archive or a broken Docker resolver. The 1 November restore failed at
discovery before `pg_restore`; the first isolated runner test also exposed an
`EPIPE` test-harness defect while listing the archive, now corrected by reading
the archive as a local file inside the disposable service.

The verified destination is the existing Cloudflare R2 bucket
`school-kit-backups`, prefix `betgenius/`. School Kit's authenticated remote
already held the correct settings; the access key ID was identical. No bucket,
key or secret was created or rotated. The exact endpoint and S3 secret were
reused securely within the VPS, with no credentials returned in logs/artifacts.
Only those two assignments changed; the bucket, provider, region and all other
ops settings stayed unchanged. Only ops was recreated. App and PostgreSQL
container IDs were verified unchanged.

## Recovery and backup evidence

- [Existing archive recovery](https://github.com/Voclain1/betgenius/actions/runs/43715408678):
  14 November 18:11 archive, 29,850,681 bytes, 19.59 hours old at test;
  SHA-256 `c955ae877ec124927f1c6bae1effc33f5d98174132042e56378893b55dea1b85`.
  Full PostgreSQL 17 restore succeeded on a disposable runner. All 42 public
  tables and column/index/constraint definitions matched the live schema;
  zero invalid indexes or unvalidated constraints. Representative restored rows:
  User 246, Prediction 7,942, Subscription 182, PaymentAttempt 68.
- [Approved repair and actual scheduled backup script](https://github.com/Voclain1/betgenius/actions/runs/43715635012):
  authenticated candidate read succeeded before mutation. The deployed backup
  script's SHA-256 matched the repository. No objects qualified for retention
  deletion. It successfully uploaded `betgenius-2026-11-15T1247Z.dump`,
  **30,184,133 bytes**, daily object modified **15 November 13:48:00 Lagos**;
  the Sunday weekly copy also completed before the script emitted success.
  Production data was not written.

- [Fresh own-remote approval audit](https://github.com/Voclain1/betgenius/actions/runs/43715713257)
  and [monthly workflow manual verification](https://github.com/Voclain1/betgenius/actions/runs/43715717153)
  both passed. Fresh dump age was 2.38–2.55 minutes; SHA-256
  `95ed97a8308eebf0a45e8cd4f6e846b550facde9bd431fb29bf9bcd34005301a`.
  Both full isolated restores reproduced 42 tables and the same schema
  fingerprint, with zero invalid indexes/unvalidated constraints. Restored rows:
  User 250, Prediction 8,012, Subscription 185, PaymentAttempt 69.
  Live target: primary PostgreSQL 17.11, database/role `betgenius`, cluster
  `7700210671175110690`. Experiment unset. The approval audit observed a stable
  source schema and no DDL candidates/schema locks at 13:49:55–13:50:36 Lagos;
  the monthly test observed the same through 13:50:52 Lagos.
  The fresh approval plan matched reviewed SHA-256
  `99ee9f0cc4270ca7dbec0842c215545c9023146e8be3335769a1c3795eea15b6`.

[Exact safe evidence](backup-recovery-resolution.json). These completed checks
clear the backup/recoverability prerequisite for the approved hash-bound,
additive schema-only operation; they do not authorize app deployment/enablement.

## Durability and scheduled recovery

The live cron reads the regenerated `/ops/env.sh` and runs the same tested
`/ops/backup.sh` nightly at 03:30 Lagos. A future unattended cron tick has not yet
been observed; successful manual execution proves the configured script path,
authentication, dump and upload, not future scheduler availability.

The monthly workflow in this PR now restores into disposable PostgreSQL 17,
instead of creating/dropping `restore_test` on the production cluster. The
production source is session-enforced read-only. It verifies target identity,
archive age/size/checksum, full restore, schema definitions and representative
rows. Its recovery-only mode has no PR-specific SQL-plan dependency; this does
not alter preflight or the separately reviewed production SQL hash guard.

GitHub denied repository secret-management access (HTTP 403), so `OPS_ENV_FILE`
has **not** been synchronized through this connection. Before any later app
deployment, an authorized owner must securely copy the repaired endpoint and
S3 secret assignments from `/opt/betgenius/ops.env` into that existing secret,
preserving all its other settings. Never paste credentials into a PR/chat.
The PR adds a fail-closed check before shipping settings that rejects malformed
R2 templates/key formats. It does not prove authentication for arbitrary future
credentials. Until this PR is merged, master does not contain that protection;
avoid an unrelated master deployment that would overwrite the repaired file.

## Rollback and operational limits

Server-local original settings are retained mode 0600 at
`/opt/betgenius/ops.env.before-backup-repair-20261115T124754Z`. If an ops regression
requires restoration, replace `ops.env` with that file and recreate **only ops**
with `docker compose --env-file deploy.env up -d --no-deps --force-recreate ops`.
That restores the previous broken storage configuration, so it is not a backup
availability fix. Keep both old and new offsite archives. Never run the old
production-cluster restore script during this approval.

Schema rollback means keeping the additive table/indexes and reverting app code
with the experiment off; do not drop tables or reservations. No database restore,
data overwrite or experimental enablement is authorized by this recovery test.
Observation of no concurrent DDL is time-bounded, not a global lock against
another administrator. Avoid concurrent schema/deploy jobs at application time.

PR #202 remains draft. Merge, app deployment and experiment enablement each
remain outside the schema-only approval.

## Approved schema-only application

[db-push 43715964797](https://github.com/Voclain1/betgenius/actions/runs/43715964797)
completed successfully following the owner's approval and both recovery proofs.
Its fresh raw SQL hash exactly matched
`99ee9f0cc4270ca7dbec0842c215545c9023146e8be3335769a1c3795eea15b6`.
The only statements created `PaidQuotaAttempt`, its primary key and the two
reviewed indexes. Prisma reported synchronization at **13:52:54 Lagos** and the
workflow's schema verification passed. The existing reviewed workflow/hash
guard is byte-for-byte unchanged. No application container was deployed or
experiment enabled. No production data manipulation or restore was performed.
