# Real-data research readiness: 14 November 2026

**Status: blocked before production. No real-world extraction, training or evaluation has been run, and no metrics exist.**

The research engine (merged in #189) is ready. A one-command isolated runner now exists and is tested. What is missing is a **verified, isolated copy of the data**. The evidence available says no usable off-server backup of the live database has been demonstrated. The routes that do exist all act on the live server and need the owner's approval.

> **Production risk, outside this research:** the only restore test ever run (1 November) found **no backups**. If that is still true, the live database has had no off-server backup since the 26 October cutover from Neon. Please verify this first, as described in section 4, whatever is decided about the research.

## 1. What was verified, and how

This was all done read-only, from the repository and GitHub Actions history. The VPS, the database and object storage were not touched.

| Question | Evidence | Finding |
|---|---|---|
| Where is the live database? | `deploy-vps` workflow: 73 runs, latest successful on 14 Nov for #189. `vps-db-copy` ran on 24 Oct (rehearsal) and 26 Oct (cutover), both successful. `docs/VPS_MIGRATION.md`. | Postgres 17 in Docker on the shared Contabo VPS (127.0.0.1:5433), next to School Kit. Neon was the source until 26 Oct. The plan was to keep it 7 days, then export a final backup and cancel. Whether Neon still exists is **unknown** here. |
| How are backups meant to work? | `deploy/ops/backup.sh`, `deploy/ops/crontab`, `deploy/docker-compose.yml`, and the `OPS_ENV_FILE` description in `docs/VPS_MIGRATION.md` | A nightly `pg_dump -Fc` at 02:30 UTC by the `ops` container, sent with rclone to the remote `backup`, which is defined only by `RCLONE_CONFIG_BACKUP_*` variables in `ops.env`. Retention is 14 daily and 8 weekly copies. A healthcheck ping is optional. |
| Has a backup ever been shown to exist? | `db-restore-test` [run 41300649446](https://github.com/Voclain1/betgenius/actions/runs/41300649446), 1 Nov 2026, the **only** run ever | **Failed:** `Config file "/root/.config/rclone/rclone.conf" not found` and then `no backups found`. |
| Has anything changed since? | `git log` of `deploy/` and the workflows since 30 Oct: no commits. No restore test since 1 Nov. | **Unverified.** The fix, if any, would be in the `OPS_ENV_FILE` secret, which is not visible from here. |
| Does this environment have any access? | Environment inspection | No `DATABASE_URL`, no research credential, no SSH key, no rclone configuration, no object-storage keys, no Neon URL. Postgres 17 binaries cannot be installed here: the PGDG repository returns 403 from the proxy, and there is no Docker daemon. |

**Why the restore test's message is ambiguous.** `restore-test.sh` runs `rclone lsf … | sort | tail -1`, so any rclone error is swallowed and reported as "no backups found". Three causes fit:

1. The `backup` remote is not defined, because `OPS_ENV_FILE` lacks `RCLONE_CONFIG_BACKUP_*`.
2. The credentials or endpoint are wrong.
3. The bucket path is empty.

In all three cases nothing was restorable on 1 Nov. In cases 1 and 2, every nightly `backup.sh` also fails at its first upload. Unless `HEALTHCHECK_PING_URL` was set, nobody is told.

## 2. Can an isolated two-table restore be done safely?

**Yes, once a verified dump exists. Nothing in this environment can obtain one safely.**

| Route | Isolated? | Status |
|---|---|---|
| **A. Latest nightly dump from object storage, restored on an isolated machine** (preferred) | Yes: no load on production | **Blocked.** No backup has been shown to exist, and this environment has no storage credentials. |
| **B. Final Neon export or Neon branch** (up to the 26 Oct cutover) | Yes | **Unknown.** Neon may have been cancelled; no credential here. It would also lack about three weeks of data. |
| **C. One-off two-table `pg_dump` from the live VPS database** | No: reads the live database | Needs owner approval. The cost is in section 5. |
| D. `db-restore-test` workflow | **No:** restores *inside* the production Postgres instance | Not used. It is not isolated, and it currently finds no backups. |
| E. `vps-db-copy` workflow | **No: destructive**, it overwrites production | Never to be used for research. |

## 3. What was prepared this sprint, so the real run is one audited command

All of this was tested on synthetic data only.

- **`research/forecasting/restore/isolated-run.sh`**, run as `--dump <file>`. In order, it:
  1. refuses to run on a host that looks like the production VPS
  2. verifies the dump: readable, has `TABLE DATA` for `Prediction` and `AIJob`, its `pg_dump` major version is no newer than the local Postgres (production is 17), and records its SHA-256 and header
  3. creates a throwaway cluster on localhost with per-run SCRAM passwords
  4. restores **only** `Prediction` and `AIJob`, so no user, payment or subscription data is ever loaded
  5. drops the prompt, raw-output and prose columns
  6. creates the documented read-only role
  7. runs the merged extractor (384 MiB heap cap, page size 50, `--as-of` set to the dump's creation time)
  8. destroys the cluster
  9. validates with `--require-real`, then runs the pre-registered evaluation at `nice 19` with 2 threads, including both sensitivity analyses
  10. writes `run-provenance.json`
- **`restore/check-isolated-run.sh`**: 17 of 17 checks pass. It covers every refusal, including the version guard, the two-table restore, teardown, validation, all eight gates, provenance and the thread cap. It also confirms that a planted canary e-mail and canary prompt reach no output.
- **`bgforecast validate`** and pipeline integration. The pipeline now refuses to train on a dataset that fails integrity checks. These cover timestamps against kickoff and `as_of`, settlement order, engine rows, identities, scores, reconciled counts, a verified read-only snapshot, and observation sanity. The validator also prints the extracted counts beside the brief's audit observations (7,928 rows, 4,403 fixture ids, 4,264 completed, and so on) as information only. There are 12 new tests.
- **Documentation fix.** The merged doc showed `pg_restore --table='"Prediction"'`. That form matches **nothing** and exits 0, which would silently restore an empty database. This was verified on Postgres 16 and is corrected in `docs/research/XGBOOST_RESEARCH_ENGINE.md` §11.

## 4. Owner actions, in order

**Step 1. Verify backups (read-only, on the VPS, takes minutes).** It reads configuration names and object listings only, and prints no secret values:

```bash
ssh deploy@<vps> 'cd /opt/betgenius && docker compose --env-file deploy.env exec -T ops sh -c \
  ". /ops/env.sh; echo rclone vars: \$(env | grep -c ^RCLONE_CONFIG_BACKUP_); echo bucket set: \${BACKUP_BUCKET:+yes}; \
   rclone lsf \"backup:\$BACKUP_BUCKET/daily\" 2>&1 | tail -5"'
ssh deploy@<vps> 'cd /opt/betgenius && docker compose --env-file deploy.env logs ops --since 72h 2>&1 | grep -E "backup ok|refusing|ERROR|Failed|NOTICE" | tail -20'
```

- **Healthy:** at least 5 `RCLONE_CONFIG_BACKUP_*` variables, the bucket is set, recent `betgenius-<date>.dump` files are listed, and the logs show `backup ok` lines.
- **Otherwise:** the backup chain is broken. Fixing it means adding the `RCLONE_CONFIG_BACKUP_*` settings to the `OPS_ENV_FILE` secret and redeploying. That is a production configuration change for the owner to make; this sprint deliberately did not touch it.

**Step 2. Obtain the dump on an isolated machine,** not the VPS. Use a machine with Postgres 17 client and server binaries, an encrypted disk, and the object-storage credentials:

```bash
rclone copyto "backup:<bucket>/daily/<latest>.dump" /secure/betgenius-latest.dump
```

**Step 3. Run the evaluation** on that machine:

```bash
git clone https://github.com/Voclain1/betgenius && cd betgenius && npm ci
python3 -m venv research/forecasting/.venv && research/forecasting/.venv/bin/pip install -r research/forecasting/requirements.txt
PG_BIN=/usr/lib/postgresql/17/bin bash research/forecasting/restore/isolated-run.sh --dump /secure/betgenius-latest.dump
```

The report is written to `research/forecasting/work/real-<stamp>/run/report.md`. Keep the whole directory private. Alternatively, grant a session access to such a machine and the dump, and the run can be done and reported from there.

**If backups cannot be fixed soon, Route C needs explicit approval.** It is a one-off two-table dump read from the live database, off-peak:

```bash
ssh deploy@<vps> 'cd /opt/betgenius && docker compose --env-file deploy.env exec -T ops \
  nice -n 19 pg_dump -Fc -t "\"Prediction\"" -t "\"AIJob\"" > /tmp/research.dump'   # pg_dump -t takes a pattern: quotes needed
```

Copy the dump off the server, delete `/tmp/research.dump`, and continue from Step 3.

## 5. Expected cost on the live server, if Route C is approved

These figures were measured in Sprint 1 on a VPS-configured local Postgres at production-like volume: 179 MB of `AIJob`, 5,150 jobs, 7,900 predictions. They come from synthetic rows.

- A full read of `AIJob` held a snapshot for about 7 seconds. Postgres server memory stayed around 290 MiB, inside the 768 MB container limit.
- `pg_dump` of the same two tables should be of the same order (seconds). Its main side effect is evicting most of the application's 192 MB buffer cache once.
- Run it off-peak, outside the 02:30 backup, 06:00 settlement and 10:30 curation crons.
- School Kit is not touched: it has a separate Postgres instance and no shared volumes.

## 6. Recommendation

**No recommendation for or against shadow-mode testing can be made: there are no real results.** Making one now would mean fabricating evidence.

The next action needs approval:

1. Run the read-only backup check in §4 Step 1. **This is recommended now in any case, as a production-safety matter.**
2. Then either:
   - provide a verified dump on an isolated machine (Route A), or
   - approve Route C for a one-off two-table dump.

Once either exists, the pre-registered evaluation runs unchanged, with no thresholds altered, and produces the full report: dataset manifest and validation, leakage findings, coverage, the eight approval gates, CIs, calibration, league-level results, both sensitivity analyses, and resource measurements.
