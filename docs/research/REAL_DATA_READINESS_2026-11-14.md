# Real-data research readiness: 14 November 2026

**Status: blocked before production. No real-world extraction, training or evaluation has been run, and no metrics exist.**

The research engine (#189) and the isolated runner (this PR) are ready and tested. What is missing is a **verified, isolated copy of the data**. No usable off-server backup of the live database has been demonstrated. The routes that do exist all act on the live server and need the owner's approval.

> **Production risk, outside this research:** the only restore test ever run (1 November) found **no backups**. Nothing since has shown otherwise. If that is still true, the live database has had no off-server backup since the 26 October cutover from Neon. The read-only check in §4 takes minutes and should be run whatever is decided about the research.

## 1. Evidence ledger

All of this comes from the repository and GitHub Actions history, read-only. The VPS, the database, object storage and secrets were not touched. Each statement is labelled:

- **Confirmed:** directly shown by code or logs.
- **Inferred:** follows from the evidence but was not verified. An attempt to run rclone here to reproduce its messages was denied by this environment's permission policy.
- **Unknown:** cannot be determined without the owner.

### Confirmed

| # | Fact | Evidence |
|---|---|---|
| C1 | The live database is Postgres 17 in Docker on the shared VPS. | `deploy/docker-compose.yml` (`postgres:17-alpine`). `deploy-vps`: 73 runs, latest successful on 14 Nov. `vps-db-copy` cutover run successful on 26 Oct. |
| C2 | Backups are designed as a nightly `pg_dump -Fc` at 02:30 UTC from the `ops` container, uploaded with rclone to remote `backup`, path `$BACKUP_BUCKET/daily/` (plus `weekly/` on Sundays). Retention is 14 days and 57 days. A healthcheck ping is optional. | `deploy/ops/backup.sh`, `deploy/ops/crontab` |
| C3 | The `backup` remote can only come from `RCLONE_CONFIG_BACKUP_*` environment variables in `ops.env`. The image ships no `rclone.conf`. | `deploy/ops/Dockerfile`, the `OPS_ENV_FILE` description in `docs/VPS_MIGRATION.md` |
| C4 | `ops.env` is written verbatim from the `OPS_ENV_FILE` secret on every deploy. That secret is **non-empty**: the deploy refuses to run otherwise, and deploys succeed. | `deploy-vps.yml` lines 93–95 and 110 |
| C5 | Every deploy runs `docker compose up -d --build`, so the `ops` container runs the repository's current scripts with the current `ops.env`. | `deploy/deploy.sh` line 31 |
| C6 | On 1 Nov `VPS_DEPLOY_ENABLED` was `true`, the `ops` container was running, and `restore-test.sh` executed in it. | The scheduled run passed the job's `if:` and reached the script ([run 41300649446](https://github.com/Voclain1/betgenius/actions/runs/41300649446)). |
| C7 | On 1 Nov `BACKUP_BUCKET` was **set**. | `restore-test.sh` runs under `set -u`; an unset variable would have printed "parameter not set" and stopped. The log has no such line. |
| C8 | On 1 Nov `rclone lsf "backup:$BACKUP_BUCKET/daily"` produced **no file names**, and the test failed with `no backups found`. | Run 41300649446 log |
| C9 | `restore-test.sh` cannot distinguish "no backups" from "listing failed". The pipeline's exit status is `tail`'s, so an rclone failure is not detected (its stderr is still printed). | `deploy/ops/restore-test.sh` line 7 |
| C10 | No restore test has run since 1 Nov. The next scheduled one is **1 Dec, 04:00 UTC**. Nothing under `deploy/` or the backup workflows has changed since 30 Oct. | Actions history (1 run in total); `git log` |
| C11 | No `deploy`, backup, restore or copy workflow was triggered for this research. | This sprint's actions |

### Inferred (not verified)

| # | Inference | Reasoning |
|---|---|---|
| I1 | The `NOTICE: Config file … not found - using defaults` line does **not** mean the remote was missing. *(Sprint 2's write-up read it that way; that was too strong, and is corrected here.)* | rclone prints this whenever no config *file* exists, including when a remote is defined entirely by environment variables, which is this design (C3). |
| I2 | The `backup` remote probably **did** resolve on 1 Nov. | An undefined remote normally makes rclone print a `didn't find section in config file` error to stderr, which would appear in the log (C9). None did. |
| I3 | So the most likely cause is that `daily/` was empty or absent in the bucket. That means either nightly uploads never succeeded (failing at `pg_dump` or upload, or cron not firing), or they go to a different path. | Follows from I2 and C8. A wrong-but-valid endpoint, or credentials that list without error, cannot be ruled out either. |

### Unknown

| # | Unknown | Who can resolve it |
|---|---|---|
| U1 | Whether any backup exists today | Owner, via §4 Steps 2–3 |
| U2 | Whether `backup.sh` runs nightly, and its outcome | Owner, via §4 Step 4 (the `ops` container logs) |
| U3 | Whether `HEALTHCHECK_PING_URL` is set, and whether its alert fires | Owner, via §4 Step 2 and the healthchecks dashboard |
| U4 | Whether Neon still exists, or a final Neon export was taken | Owner (Neon console) |
| U5 | The object-storage provider, bucket path and retention as actually configured | Owner (`OPS_ENV_FILE`, which is write-only in GitHub) |

## 2. Can an isolated two-table restore be done safely?

**Yes, once a verified dump exists. Nothing in this environment can obtain one safely.** This environment has no database, VPS, object-storage or Neon credential. It cannot install Postgres 17 either: the PGDG repository returns 403 and there is no Docker daemon.

| Route | Isolated? | Status |
|---|---|---|
| **A. Latest nightly dump from object storage, restored on an isolated machine** (preferred) | Yes: no load on production | **Blocked** until U1 is resolved |
| **B. Final Neon export or Neon branch** (data up to 26 Oct) | Yes | **Unknown** (U4). It would also lack about three weeks of data. |
| **C. One-off two-table `pg_dump` from the live database** | No: reads the live database | Needs explicit owner approval; cost in §5 |
| D. `db-restore-test` workflow | **No:** restores *inside* the production Postgres instance | Not used |
| E. `vps-db-copy` workflow | **No: destructive**, it overwrites production | Never to be used for research |

## 3. Follow-up on the 1 November restore-test failure

- **What it proves:** on 1 Nov there was no restorable file under `$BACKUP_BUCKET/daily/` that the `ops` container could list (C8).
- **What it does not prove:** that the remote was unconfigured (I1), or that no backup existed anywhere.
- **Why it went unnoticed:** the next automatic check is not until 1 Dec (C10). Nightly backup failures are only reported if a healthcheck URL is configured (U3).
- **Recommended now:** the owner runs §4. It answers U1–U3 in minutes, read-only.
- **Recommended later (not done here, because it changes deployed infrastructure):** make `restore-test.sh` fail loudly when the listing fails, not just when it is empty. Make `HEALTHCHECK_PING_URL` mandatory in `OPS_ENV_FILE`. Consider a weekly restore test while backups are unproven.

## 4. Minimal read-only backup verification (owner)

These steps run on the VPS as the `deploy` user. They read configuration **names** (never values), object listings and container logs. They do not touch Postgres, change files, or print secrets. Do **not** substitute `rclone config show` or a bare `env`: both print secret values.

```bash
ssh deploy@<vps>
cd /opt/betgenius
C="docker compose --env-file deploy.env"

# Step 1. The ops container is up, and the backup job is scheduled.
$C ps ops
$C exec -T ops grep backup /etc/crontabs/root

# Step 2. Which settings are present (prints "set" or "MISSING", never a value).
$C exec -T ops sh -c '. /ops/env.sh; for k in BACKUP_BUCKET RCLONE_CONFIG_BACKUP_TYPE RCLONE_CONFIG_BACKUP_PROVIDER \
  RCLONE_CONFIG_BACKUP_ENDPOINT RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY HEALTHCHECK_PING_URL; do
  eval "v=\${$k:-}"; if [ -n "$v" ]; then echo "$k: set"; else echo "$k: MISSING"; fi; done'

# Step 3. Does the remote resolve, and what is in it? Prints file names, sizes and times only.
$C exec -T ops sh -c '. /ops/env.sh; rclone lsf "backup:$BACKUP_BUCKET" --max-depth 1; echo "exit=$?";
  rclone lsf "backup:$BACKUP_BUCKET/daily" --format tsp --max-depth 1 | sort | tail -5; echo "exit=$?"'

# Step 4. What did the nightly job do over the last 4 days?
$C logs ops --since 96h 2>&1 | grep -E "backup ok|refusing|ERROR|CRITICAL|Failed|didn't find section" | tail -20
```

| What you see | Meaning | Next |
|---|---|---|
| Step 2 shows all `RCLONE_CONFIG_BACKUP_*` and `BACKUP_BUCKET` as `set`; Step 3 lists recent `betgenius-<date>.dump` files with plausible sizes (tens of MB or more); Step 4 shows `backup ok` lines | Backups are running | Go to §6 Route A with the newest file |
| Step 2: any `RCLONE_CONFIG_BACKUP_*` is `MISSING` | The remote cannot work | Add the settings to `OPS_ENV_FILE` and redeploy (owner change) |
| Step 3: `didn't find section in config file`, or `exit=` not 0 | The remote does not resolve, or the listing fails (endpoint or credentials) | Fix `OPS_ENV_FILE` |
| Step 3: listing works, but `daily/` is empty or absent; Step 4 shows errors | Uploads fail | Read the Step 4 error; usually credentials or bucket permissions |
| Step 3: `daily/` empty; Step 4 shows **nothing** (no `backup ok`, no errors) | The nightly job is not running | Check crond in the `ops` container |
| Step 2: `HEALTHCHECK_PING_URL: MISSING` | A future failure will be silent again | Add it (healthchecks.io) |

**Optional Step 5,** on an isolated machine and not the VPS, using the same storage credentials. Download the newest dump and confirm it is readable, without restoring anything:

```bash
rclone copyto "backup:<bucket>/daily/<newest>.dump" /secure/betgenius-latest.dump
pg_restore -l /secure/betgenius-latest.dump | head -5     # needs Postgres 17 client binaries
```

## 5. Expected cost on the live server, if Route C is approved

These figures were measured in Sprint 1 on synthetic rows at production-like volume, on a local Postgres configured like the VPS: 179 MB of `AIJob`, 5,150 jobs and 7,900 predictions.

- A full read of `AIJob` held a snapshot for about 7 seconds.
- Postgres server memory stayed around 290 MiB, inside the 768 MB container limit.
- `pg_dump` of the same two tables should be of the same order (seconds). Its main side effect is evicting most of the application's 192 MB buffer cache once.
- Run it off-peak, outside the 02:30 backup, 06:00 settlement and 10:30 curation crons.
- School Kit is not touched: it has a separate Postgres instance and no shared volumes.

```bash
ssh deploy@<vps> 'cd /opt/betgenius && docker compose --env-file deploy.env exec -T ops \
  nice -n 19 pg_dump -Fc -t "\"Prediction\"" -t "\"AIJob\"" > /tmp/research.dump'   # pg_dump -t takes a pattern: quotes needed
```

Copy the dump off the server immediately, then delete `/tmp/research.dump`.

## 6. Running the evaluation once a dump exists

On an isolated machine with Postgres 17 client and server binaries, Node 20+, Python 3.12+ and an encrypted disk:

```bash
git clone https://github.com/Voclain1/betgenius && cd betgenius && npm ci
python3 -m venv research/forecasting/.venv && research/forecasting/.venv/bin/pip install -r research/forecasting/requirements.txt
PG_BIN=/usr/lib/postgresql/17/bin bash research/forecasting/restore/isolated-run.sh --dump /secure/betgenius-latest.dump
```

**What the runner guarantees.** All of it is tested by `restore/check-isolated-run.sh`, with 36 checks on a synthetic dump.

- **Never on production:** it refuses if it finds deployment directories, BetGenius or School Kit containers or compose projects, School Kit's `edge` network, or a listener on the VPS Postgres port. This happens before the dump is opened.
- **Isolation:**
  - The scratch cluster listens on a **Unix socket in a private 0700 directory only**: no TCP and no fixed port, so it cannot collide with or be mistaken for another instance.
  - The runner verifies it is talking to its own data directory.
  - Inherited `PG*` and database URL variables are cleared. A decoy server on the old fixed port, with a hostile `PG*` environment pointing at it, receives no connection.
- **Minimal data:** only `Prediction` and `AIJob` are restored, and prompt, raw-output and prose columns are dropped. Canary data never reaches any output.
- **Cleanup:** on any failure (dump, restore, extract, validate or evaluate stage, a truncated dump, or SIGTERM), the cluster is destroyed and incomplete outputs are deleted. `--keep-failed-outputs` keeps the outputs for debugging. Existing output directories are never overwritten.
- **No secrets in logs:**
  - Passwords are generated per run and live only in a 0600 passfile, in SQL fed on stdin, and in the extractor's environment.
  - Database errors are reduced to one scrubbed line, because DETAIL and CONTEXT lines can quote row data.
  - Every log passes through a scrubber.
  - Tests confirm that no password, connection string or canary appears in any log or output.

The report is written to `research/forecasting/work/real-<stamp>/run/report.md`. Keep the whole directory private.

## 7. Recommendation

**No recommendation for or against shadow-mode testing can be made: there are no real results.** Making one now would mean fabricating evidence.

The next action needs approval:

1. Run §4 now, as a production-safety matter.
2. Then either:
   - give a verified dump to an isolated machine (Route A), or
   - approve Route C for a one-off two-table dump.

The pre-registered evaluation then runs unchanged, with no thresholds altered.
