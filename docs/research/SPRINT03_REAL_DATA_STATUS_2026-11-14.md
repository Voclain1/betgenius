# Sprint 03: real-data evaluation status, 14 November 2026

## Executive summary

**The real historical evaluation has not been run. There are no real-data results, metrics or recommendation.** Nothing below is a model result.

The backup that the evaluation needs now exists and is readable, on the owner's evidence. What is missing is an **approved isolated machine** on which to restore it. Under the safety rules, no environment available to this session qualifies:

- no machine is connected via Remote Control
- the only environments are Anthropic cloud containers, which are third-party infrastructure not approved as a data destination
- there is no R2 credential, and Postgres 17 cannot be installed here

This sprint therefore makes the run a single owner-side command, `fetch-and-run.sh`: R2 → encrypted disk → isolated restore → evaluation → deletion. It also proves the runner against real Postgres 17 binaries in CI, and ends with one approval request (§6).

| Level | Status | Evidence |
|---|---|---|
| 1. Backup archive exists and is readable | **Yes** (owner-reported; not independently verifiable here) | `betgenius-2026-11-14T1711Z.dump`, 29,850,681 bytes, uploaded by the production backup script to `backup:${BACKUP_BUCKET}/daily/`. A separate download and `pg_restore --list` succeeded. |
| 2. Full restore of the research tables | **Not done** | Needs an approved isolated machine (§6) |
| 3. Research execution (extraction, validation, evaluation, gates) | **Not done** | Depends on 2 |
| 4. Production readiness of a forecasting model | **No** | No evidence exists. Even a "proceed" verdict only authorises a shadow-mode trial. |

## 1. Workstream A: readiness, verified

| Item | Finding | How it was verified |
|---|---|---|
| Repository state | Master `e070c89` includes #189 and #191 unchanged (squash `8eb52ba`). Its research, docs, deploy and workflow trees are identical to the reviewed PR head `afd6a8a`. | `git diff` against the PR head |
| Production refusal | It refuses on deployment directories, BetGenius or School Kit containers and compose projects, the `edge` network, a 5433 listener, or an unreadable `/proc/net/tcp`, all before any download or restore. It is now one shared library (`restore/lib-host-check.sh`) used by both tools. | `check-isolated-run.sh` (36 checks), `check-fetch-and-run.sh` (production-host case) |
| Postgres 17 compatibility | Production dumps are pg_dump 17 (`deploy/ops` builds on `postgres:17-alpine`). A new CI job runs the full isolated-runner and fetch checks with **PGDG Postgres 17 binaries**, and restores a **17 dump with 18 binaries**. The version guard refuses a dump newer than the local binaries. | `research-forecasting.yml` job `restore-postgres-17`; locally on 16; on the default runner with 18 |
| Deploy consumes `OPS_ENV_FILE` | Confirmed. `deploy-vps.yml` refuses an empty secret, writes it verbatim to `out/ops.env` and ships it to `/opt/betgenius`. `deploy.sh` runs `docker compose up -d --build`, which recreates `ops` when its environment changes. | `deploy-vps.yml` lines 93–95, 110, 121; `deploy/deploy.sh` line 31 |
| Does the R2 fix survive redeployment? | **Yes, if and only if the `OPS_ENV_FILE` secret contains `RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true`.** The owner reports updating both the secret and the VPS file. The secret is write-only, so this cannot be read here. **Not yet exercised:** the last deploy (run 76, 16:53–16:57Z) finished *before* the verified upload at 17:11Z. No deploy was triggered to test it. | Actions history; deploy mechanism above |
| Verify after the next natural deploy | `REAL_DATA_READINESS_2026-11-14.md` §4 Step 2 now also prints `RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET: set/MISSING`. Step 4 shows whether the following 02:30 backup logged `backup ok`. | Doc update in this PR |
| What the fix explains | Sprint 2 inferred that the 1 Nov `daily/` listing was empty because uploads failed (I3). A read-only R2 token, or one without bucket-level rights, makes rclone's bucket check fail. That is the behaviour `no_check_bucket` disables, so the owner's fix is consistent with the inference. | Inference, not independently verified |
| Off-VPS execution environment | **None available.** No folders are connected via Remote Control (`list_computer_folders` is empty). The cloud environments `Default` and `Workspace 1` are Anthropic-operated containers with no R2 or Postgres 17 access. | Session tools, read-only |

### The remaining gap between "readable" and "restorable"

`pg_restore --list` reads the archive's table of contents only. It does not prove that:

- the `Prediction` and `AIJob` data blocks decompress
- the rows load into tables
- the restored data passes the dataset validator

The isolated runner checks all three before any modelling, and fails closed. The owner can pre-check the first point on the downloaded copy:

```bash
pg_restore -l betgenius-2026-11-14T1711Z.dump | grep -E '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA public (Prediction|AIJob) '
```

Two lines are expected.

## 2. Workstream B: the secure handoff

`research/forecasting/restore/fetch-and-run.sh` is run by the owner, on the isolated machine. In order, it:

1. **Refuses the production host** before touching anything (the shared library).
2. **Enforces least-privilege credentials.** It refuses the production backup remote (`RCLONE_CONFIG_BACKUP_*`, which can write and delete backups) and requires a separate `researchr2` remote, intended for an **R2 API token with Object Read only, scoped to the backup bucket**. It requires `NO_CHECK_BUCKET=true`, and reads credentials from the environment only (names checked, values never printed).
3. **Refuses Postgres older than 17** before downloading.
4. **Checks the storage.** The secure directory must be private (0700), owned by the operator, outside the repository, and on encrypted storage. Encryption is detected for dm-crypt/LUKS, eCryptfs, gocryptfs and CryFS; otherwise the operator must confirm it explicitly with `--confirm-encrypted-storage`. The repository checkout, where outputs are written, is held to the same requirement. Free space must be at least 6× the dump size.
5. **Downloads one object** from `researchr2:$RESEARCH_R2_PATH/<key>`. `RESEARCH_R2_PATH` is the `BACKUP_BUCKET` value as **bucket/prefix**, never assumed bucket-only. The download lands in a `.partial` file (umask 077), then the exact byte count (`--expect-bytes 29850681`) and the optional SHA-256 are checked, and only then is the file moved into place at mode 0600. Download errors are reported with URLs and remote paths removed.
6. **Runs `isolated-run.sh`** with `TMPDIR` on the secure volume, so the scratch database holding restored rows also sits on encrypted storage. Everything from #191 applies: a socket-only cluster, only `Prediction` and `AIJob` restored, prompts, raw output and prose dropped, the read-only role, validation, the pre-registered evaluation, and cleanup on failure.
7. **Deletes the dump** (overwrite, then unlink) on success **and** on failure, unless `--keep-dump`. It then writes `fetch-receipt.json`: object key, bytes, SHA-256, time, and whether the dump was deleted. The bucket and endpoint are not recorded.

**Tests:** `restore/check-fetch-and-run.sh` uses a fake rclone and a synthetic dump. It covers:
- every refusal, each with no download made
- size and SHA mismatch, a download error, and a failure inside the run, each leaving the secure directory empty
- a full run, and `--keep-dump`
- leak scans: no credential value, bucket path, endpoint or canary in any log or output

**Data copies.** Exactly one copy of the dump is made (R2 to the encrypted disk). One scratch database exists only for the duration of extraction. The derived dataset and report stay in `research/forecasting/work/` (gitignored) on the same encrypted volume. Nothing touches GitHub, CI or any third party.

## 3. Workstream C: restore and evaluation

**Not executed** (see §6). When run, the output directory `research/forecasting/work/real-<stamp>/` will contain:

| File | Contents |
|---|---|
| `dataset/manifest.json` | Exact fixture, prediction and job counts; every exclusion and job verdict with reasons; context versions; and the audit of availability, same-day and missing-score entries. |
| `validation.log` | Hard integrity checks, plus extracted counts beside the brief's audit figures (7,928 rows, 4,403 fixture ids, and so on) |
| `run/report.md`, `run/results.json` | The full results (listed below) |
| `run-provenance.json`, `fetch-receipt.json` | Dump hash, rows restored, versions, timings |

The report contains:
- coverage on all fixtures and on the test period
- the chronological split dates and embargo counts
- walk-forward tuning
- base rate, Poisson and XGBoost (raw and calibrated): log loss, Brier and accuracy with 95% bootstrap CIs, ECE, and reliability
- paired differences
- per-league results, and Over/Under 2.5 and BTTS
- the selection-conditional engine comparison
- boundary sensitivity (15%, 25%, 30%) and the ledger-mode sensitivity
- the **eight pre-registered gates** with measured values

If the sample is too small (fewer than 300 test fixtures, or under 70% history coverage on all fixtures or on the test period), the report says **improve data** and names the failing gate. The thresholds are fixed in `bgforecast/pipeline.py` and are not changed by this sprint.

**Expected cost on the isolated machine,** from the synthetic benchmarks at production-like volume:
- extraction about 10 s at roughly 400 MiB
- training and report about 4–5 min at 2 threads, about 360 MiB
- disk about 6× the dump, roughly 180 MB

## 4. Workstream D: quality

| Check | Result |
|---|---|
| `tsc --noEmit` (whole project) | pass |
| `npm run check:research-extract` | pass |
| `run-local-integration.sh` (extractor against a local Postgres) | 18/18 |
| `pytest` (`research/forecasting/tests`) | 91 passed |
| `check-isolated-run.sh` | 36/36 (Postgres 16 locally; on CI also 18, 17, and 17 dump → 18) |
| `check-fetch-and-run.sh` | 22/22 (Postgres 16 locally; CI on 18 and 17) |

The research-only defect fixed this sprint was in the new fetch check itself: the run output contains two `done:` lines, and the check captured both. No production code, schema, cron schedule, entitlement, UI, pricing or School Kit resource was touched.

## 5. Reproducibility: the owner run

On a dedicated isolated machine with full-disk or volume encryption, Postgres 17 or newer, Node 20 or newer, Python 3.12 or newer, and rclone:

1. In Cloudflare, create an **R2 API token**: permission **Object Read only**, applied to the backup bucket only, with a short TTL. Revoke it after the run.
2. Prepare the checkout and environment:

   ```bash
   git clone https://github.com/Voclain1/betgenius /secure/betgenius && cd /secure/betgenius && npm ci
   python3 -m venv research/forecasting/.venv && research/forecasting/.venv/bin/pip install -r research/forecasting/requirements.txt
   export RESEARCH_R2_PATH='<BACKUP_BUCKET value: bucket/prefix>'
   export RCLONE_CONFIG_RESEARCHR2_TYPE=s3 RCLONE_CONFIG_RESEARCHR2_PROVIDER=Cloudflare RCLONE_CONFIG_RESEARCHR2_NO_CHECK_BUCKET=true
   export RCLONE_CONFIG_RESEARCHR2_ENDPOINT='https://<account-id>.r2.cloudflarestorage.com'
   read -rs RCLONE_CONFIG_RESEARCHR2_ACCESS_KEY_ID && export RCLONE_CONFIG_RESEARCHR2_ACCESS_KEY_ID
   read -rs RCLONE_CONFIG_RESEARCHR2_SECRET_ACCESS_KEY && export RCLONE_CONFIG_RESEARCHR2_SECRET_ACCESS_KEY
   ```

3. Run it:

   ```bash
   PG_BIN=/usr/lib/postgresql/17/bin bash research/forecasting/restore/fetch-and-run.sh \
     --object daily/betgenius-2026-11-14T1711Z.dump --expect-bytes 29850681 --secure-dir /secure/bgf-dump
   ```

   Add `--confirm-encrypted-storage` only if the script cannot detect encryption that you know is there.
4. Read `research/forecasting/work/real-<stamp>/run/report.md`. Share **only** the report, or chosen figures from it, back to the session or PR. Never share the dataset, the dump or the logs.
5. Revoke the R2 token, then `unset` the variables.

## 6. The one approval needed

**Choose where the restore runs.** In order of preference:

- **A. The owner's own isolated machine (recommended).** Run §5 there. Nothing leaves owner-controlled, encrypted storage, and no session needs credentials.
- **B. The same machine, driven by a session.** Add the checkout folder in the Claude desktop app (Settings → Claude Code → Remote Control), then ask a session to run §5. Credentials are still entered by the owner on that machine, never in chat.
- **C. An Anthropic cloud container.** This needs *explicit* approval of that destination and its retention (deleted at the end of the run, and the container discarded after the session). It also needs:
  - a network allowance for the R2 endpoint and the Postgres package repository
  - a way to give the R2 key to the container for request signing (S3 requests cannot use header injection)

  Not recommended.

Once the report exists, the next sprint interprets it against the pre-registered gates, without changing them.
