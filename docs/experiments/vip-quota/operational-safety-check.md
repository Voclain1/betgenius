# PR #202 operational safety check — 15 November 2026

**Verdict: BLOCKED for a safe schema-only production operation.** The intended database and unchanged reviewed schema plan are verified. Backup freshness and recoverability cannot be verified because the production ops container cannot resolve the configured backup destination hostname. No production data/schema/configuration was modified; no `db-push`, deployment, merge or experiment enablement was performed.

## Exact evidence

The latest [read-only audit 43708477253](https://github.com/Voclain1/betgenius/actions/runs/43708477253) ran from `8189e59`; its operational job is `132794651043`. It intentionally stopped on the backup access problem. [Machine-readable evidence](operational-evidence.json) preserves the safe metadata and source timestamps, without credentials or customer rows.

| Check | Observed result |
|---|---|
| Intended app target | Running app: host `postgres`, port `5432`, database/user `betgenius`; experiment flag **unset**. |
| Production identity | App target, ops connection and repository database secret agree. PostgreSQL **17.11**, primary cluster `7700210671175110690`, database `betgenius`. SQL sessions reported `transaction_read_only=on`. |
| Reviewed SQL | Fresh read-only Prisma diff produced exactly `99ee9f0cc4270ca7dbec0842c215545c9023146e8be3335769a1c3795eea15b6` in all three audits. `PaidQuotaAttempt` is still absent. The existing reviewed hash guard is unchanged. |
| Schema activity | At **12:13:18, 12:17:42 and 12:22:04 Lagos time**, no active DDL candidates or conflicting schema-lock candidates were seen; catalog fingerprint stayed `040be914316fcf7e41ece3ee87220a98`. At **12:23:39 Lagos**, GitHub had no running/queued `db-push`, `deploy-vps` or `vps-db-copy` run. These are observations, not a lock preventing future/external DDL. |
| Backup settings | All six expected bucket/type/provider/endpoint/access-key/secret-key variables were present. Presence does not prove their values are correct. No values were printed. |
| Current storage request | Production `rclone lsjson` exited **1**; safe error token: **`no such host`**. |
| DNS isolation | Inside the production ops container: control hostname `example.com` **resolves**; configured endpoint hostname **does not resolve**; hostname from the failed request **does not resolve**. Endpoint did not match the reserved-example/`.invalid` domain check. Only hostname hashes were recorded. |
| Recent backup logs | No successful `backup ok` line was found in the available current-container logs requested for the last 72 hours. This is not proof that no older/offsite backup exists; container log retention/recreation can limit history. |
| Freshness/recovery | **Unverified.** No production archive could be listed, downloaded or restored. No backup-corruption conclusion is supported. |

The configured endpoint hostname hash is `24ed390dead82200d83f18d996e0f28fb227f90e735afb14e9f46c7133a3f028`; the failed request hostname hash is `a5cdddc66574a7d7666bd7020980963ae3be6d233091f9817f31b32a3bba8683`. They differ, so the failed request may involve a provider-derived/bucket-prefixed hostname. Both independently failed DNS resolution; the audit did not guess or change a replacement endpoint.

## What the original restore failure means

The full [1 November scheduled restore log](https://github.com/Voclain1/betgenius/actions/runs/41300649446) was recovered through the GitHub connector's structured log payload. At **12:09:57 Lagos time**, it logged:

```
NOTICE: Config file "/root/.config/rclone/rclone.conf" not found - using defaults
no backups found
Process completed with exit code 1.
```

It stopped during backup discovery, before `pg_restore` was invoked. The config-file notice alone is not a fault: this stack supplies rclone settings using environment variables. The old restore script's `rclone lsf ... | sort | tail -1` pipeline can also hide a failed listing behind an empty result because POSIX shell pipeline status comes from `tail`.

The current evidence establishes a **production backup-destination hostname/DNS access problem**, not archive corruption or a defect in the new table. It is not merely the GitHub runner's scratch-restore environment: the failing rclone/DNS probes ran inside the production ops container. Both backup creation and the scheduled restore use this configuration, so creation may also be affected. Historical settings may have differed; the precise DNS cause on 1 November cannot be reconstructed from that old log alone.

## Remaining blocker and next operational step

An operator must investigate/correct the backup destination endpoint/provider-derived hostname or its DNS configuration, then demonstrate that the intended offsite backup can be accessed. A fresh backup's timestamp/size and a successful full isolated restore must be verified before this safety check can clear the schema-only operation. No credential/configuration/DNS changes or backup uploads/deletions were attempted here.

The existing `sprint11-production-audit` workflow now has a manual `operational_safety_only=true` mode for repeating this check. Its production SQL is read-only and verified as such; remote filesystem/storage commands only read metadata or objects. It never invokes the production restore script. If an archive becomes accessible, it restores only into the job's disposable PostgreSQL 17 service, reports aggregate counts and deletes the runner-only archive without uploading it as an artifact. Other audit mode behavior and the monthly restore workflow were not changed.

Local checks validated the actual read-only SQL against PostgreSQL 17, shell quoting, a complete synthetic isolated archive restore, and fail-closed behavior for an empty inventory. Those local results are **not** proof of production backup recoverability.

Keep PR #202 in draft and preflight intact. After backup access/recovery evidence is available, rerun the read-only operational audit and recheck concurrent DDL immediately before any separately approved schema-only operation. The reviewed hash guard must still match; this report grants no write/merge/deploy/enable approval.
