# Backup storage correction investigation — 15 November 2026

**Status: awaiting authoritative Cloudflare R2 configuration; no production correction applied yet.** This extends the operational evidence in PR #202 and does not authorize or execute the VIP/Premium schema operation.

## Root cause established

[Probe 43709937297](https://github.com/Voclain1/betgenius/actions/runs/43709937297), at **12:40–12:41 Lagos time**, reports:

- Remote type `s3`, provider `Cloudflare`, region `auto`.
- The endpoint is **not parseable as a URL** and contains template markers. There is no surrounding whitespace or removable quote/angle wrapper; safe normalization does not change it. No complete endpoint, credential or URL userinfo was printed.
- The endpoint in `/opt/betgenius/ops.env`, the running container and the saved `/ops/env.sh` cron environment agrees. This is not an old container retaining a newer on-disk setting.
- The ops container uses Docker's `127.0.0.11` resolver. Control DNS resolution works both inside that container and on the independent runner. The malformed destination and failed request hostname remain unresolved.
- The production target remains the same primary PostgreSQL 17.11 `betgenius` database, with read-only audit sessions, no observed active DDL/schema locks, an unchanged catalog fingerprint and the exact reviewed Prisma plan hash. The experiment flag remains unset.

The verified issue is **an incomplete/malformed Cloudflare R2 endpoint setting**. The evidence does not support changing Docker DNS servers, adding a hosts-file override, disabling TLS verification, declaring an endpoint expired or fabricating a replacement account ID.

## Exact missing provider information

The Cloudflare account owner must copy the **S3 API endpoint shown for the intended R2 account/bucket**, including any jurisdiction-specific form, and confirm the intended `BACKUP_BUCKET` bucket/prefix. Cloudflare documents the ordinary endpoint as `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`; `<ACCOUNT_ID>` must be the actual account identifier, not a literal template. See [Cloudflare's S3 API documentation](https://developers.cloudflare.com/r2/api/s3/api/).

The endpoint/account identifier and bucket/prefix are configuration identifiers, not authentication keys. Access/secret keys should remain in the existing secure configuration and must not be sent in chat or printed in logs. Do not rotate an existing valid key pair simply to replace an endpoint. Confirm authenticated access after using the provider-confirmed endpoint; resolve any separate credential issue only if the evidence establishes one.

## Smallest safe correction once those inputs are available

1. Test the provider-confirmed endpoint in a **single-process rclone environment override**, using the existing key pair and intended bucket/prefix. Require normal DNS, verified HTTPS and authenticated listing; do not persist a guessed destination.
2. On success, replace only the incorrect endpoint setting in the production `ops.env` and the existing GitHub `OPS_ENV_FILE` secret source so a later deployment cannot revert the repair. Preserve other values, credentials, ownership and restrictive permissions. Recreate only the ops container if needed to refresh its environment; do not restart/deploy the app or database.
3. Identify the latest complete archive by timestamp/size and provider hash where supported. Download without exposing records, then perform the existing logical recovery procedure in a disposable PostgreSQL 17 instance, never in the production cluster. Verify full restore success, schema/constraints and representative data before claiming recovery.
4. Verify backup creation and scheduled recovery compatibility after the correction without relaxing safety checks. The production monthly script creates a scratch database on the production server; it must not be invoked under this task's no-production-database-writes restriction. Recovery verification must stay on isolated infrastructure.
5. Recheck the reviewed schema hash and current schema activity immediately before any later, separately approved schema operation.

## Readiness

Authenticated storage access, latest backup age/size, production-archive integrity, isolated production-backup recovery and successful scheduled operation remain **unverified**. They cannot be established while the configured endpoint is incomplete. No production data/schema/configuration was changed during this investigation, and no backup object was uploaded/deleted. PR #202 stays draft; the existing exact-SQL hash guard remains intact. Schema-only deployment is **not yet safe to authorize**.

## Final configuration verification

[Run 43712813984](https://github.com/Voclain1/betgenius/actions/runs/43712813984), **13:16 Lagos time**, repeated the endpoint/file/container checks and added credential-format checks that do not disclose values. [Evidence](storage-recovery-evidence.json):

- Access-key ID matches the expected R2 hexadecimal-32 format.
- The configured secret does **not** match the expected R2 hexadecimal-64 S3 Secret Access Key format. This is a format warning, not an authenticated revocation determination. Verify that the intended **S3 Secret Access Key** was entered, rather than a different Cloudflare API token or placeholder. Use the original valid pair if available; do not rotate unnecessarily. Supply/fix keys only through the secure configuration, never chat.
- The bucket value has no detected template markers; its intended account/bucket/prefix still needs owner confirmation.
- The malformed endpoint still contains template markers and exactly agrees across persisted configuration, container and saved cron environment. DNS control checks pass; no normalization-only correction is available.
- The fresh production diff still matches the reviewed SQL hash. The live database and experimental settings remain unchanged.

An information request for the provider-issued endpoint and intended bucket/prefix is pending. Neither a Cloudflare account identifier nor an authenticated bucket destination can safely be fabricated from these fields. Consequently no production configuration change was applied, no backup was retrieved, and latest backup creation time/size/integrity and isolated recovery remain unknown. Scheduled backup/restore success cannot be claimed. The needed external action is for the Cloudflare account owner to obtain the actual S3 endpoint from **R2 → intended bucket → Settings** and verify the existing S3 credential pair securely. This is account-configuration completion; no provider DNS outage, expired service endpoint or corrupt archive was demonstrated.
