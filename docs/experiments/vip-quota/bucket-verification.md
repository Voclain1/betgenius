# Verified live backup bucket — 15 November 2026

[Read-only verification 43714286732](https://github.com/Voclain1/betgenius/actions/runs/43714286732) succeeded at **13:32–13:33 Lagos time**. [Exact safe metadata](bucket-verification.json).

- BetGenius's persisted, container and cron configuration all specify `BACKUP_BUCKET=school-kit-backups/betgenius`.
- School Kit specifies `BACKUP_BUCKET=school-kit-backups`.
- The existing School Kit `backup:` remote uses S3 with provider `Other`, at `46ec5b1fe217cb7a05ba922f8b306870.r2.cloudflarestorage.com`. This is a Cloudflare R2 endpoint.
- Authenticated listing succeeded for the `school-kit-backups` bucket, `betgenius` prefix and `betgenius/daily` prefix.
- One BetGenius archive was found: `betgenius/daily/betgenius-2026-11-14T1711Z.dump`, **29,850,681 bytes** (about 28.47 MiB), modified **14 November 2026, 18:11:30 Lagos time**. Its age at verification was about **19 hours 22 minutes**.
- No weekly archive was listed at `school-kit-backups/betgenius/weekly`.
- Listing `scholkit` and listing all account buckets were denied to this credential. These denials do not prove absence of another bucket; account-wide inventory is not verified.

**Answer:** BetGenius's verified existing backup destination is a shared **Cloudflare R2 `school-kit-backups` bucket**, under `betgenius/`. It is not configured to use the bucket named `scholkit`, and no new bucket needs to be created to explain its current backup path.

This resolves the earlier uncertainty about whether an offsite BetGenius archive exists. The read used the already-working School Kit remote; no key was copied/exposed/rotated, no object was created or changed, and no production setting or database was changed. It does **not** establish that BetGenius's own malformed remote works, that the archive restores successfully, or that scheduled backups are healthy. The existing schema-only safety gate therefore remains unresolved pending repair/recovery proof. The previous example `scholkit/betgenius` was a proposed path, not verified configuration.
