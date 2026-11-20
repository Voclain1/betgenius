# Forecasting research engine: XGBoost and Poisson

Status: **implemented and tested on synthetic data only. No real-world extraction, training or evaluation has been run.** This environment has no database credential. Every number in this document that describes model behaviour comes from synthetic test data and says so.

The question this engine answers: can a statistical model, trained only on information that existed when BetGenius generated each prediction, forecast match outcomes better than (a) a Poisson baseline, (b) the base rate, and (c) the existing engine's own stated confidence? It does not change production. It reads a snapshot, writes files to a gitignored directory, and stops there.

## Contents

1. [What it does not touch](#1-what-it-does-not-touch)
2. [Layout](#2-layout)
3. [Point-in-time integrity](#3-point-in-time-integrity)
4. [Extractor](#4-extractor)
5. [Secure read-only execution](#5-secure-read-only-execution)
6. [Features](#6-features)
7. [Models](#7-models)
8. [Chronological validation](#8-chronological-validation)
9. [Evaluation and the decision rule](#9-evaluation-and-the-decision-rule)
10. [Running it](#10-running-it)
11. [Dependencies and resources](#11-dependencies-and-resources)
12. [Tests](#12-tests)
13. [Limitations](#13-limitations)

## 1. What it does not touch

- No production database writes, migrations or schema changes. `prisma/schema.prisma` is unchanged.
- No API-Football calls. Only what was stored at generation time (`AIJob.context`) and at settlement (`Prediction.finalHomeScore/finalAwayScore/settledAt`) is read.
- No enrichment-cache reads. Current cache values are never substituted for historical observations.
- No change to the prediction engine, paid-tier selection, calibration, publishing, cron jobs or any page. Nothing under `src/` is modified; the extractor imports `parseStoredContext`, `buildMatchDigest` and `resolveMarket` read-only, so it reads stored contexts exactly as production does.
- No automatic publishing. The model artifact is marked `research_only: true` and nothing loads it.
- No public copy. Nothing here renders on the site.

## 2. Layout

```
research/forecasting/
  extract/                       TypeScript, read-only extractor
    schema.ts                    dataset contract, exclusion reason codes, SCHEMA_VERSION
    core.ts                      pure: consolidation, context selection, observations
    assemble.ts                  pure: rows -> dataset files + manifest
    readonlyDb.ts                read-only snapshot session and posture checks
    extract.ts                   CLI
    check-extract-core.ts        unit checks (synthetic rows)
    integration/                 end-to-end check and extraction benchmark, both against a throwaway local Postgres
  restore/                       real-data runner: isolated two-table restore -> extract -> validate -> evaluate
    isolated-run.sh              the one command for a real run from a pg_dump file
    fetch-and-run.sh             owner-run: one object from R2 (read-only token) -> encrypted disk -> isolated-run -> delete
    lib-host-check.sh            shared production-host refusal (both tools refuse before any download or restore)
    check-isolated-run.sh        end-to-end check of the runner on a synthetic dump
    check-fetch-and-run.sh       end-to-end check of the fetch wrapper with a fake rclone
    testlib-synthetic-dump.sh    test-only synthetic full-schema dump builder (DUMP_PG_BIN for cross-version)
  bgforecast/                    Python modelling package
    dataset.py                   load + verify (schema version, SHA-256 per file)
    validate.py                  integrity checks run before any training; audit-figure comparison
    ledger.py                    point-in-time match ledger
    features.py                  deterministic feature extraction
    poisson.py                   Model A
    xgb_model.py                 Model B, tuning, versioned artifacts
    calibration.py               temperature scaling
    splits.py                    chronological partitions with a label-time embargo
    metrics.py                   scoring rules, calibration, bootstrap CIs
    engine_compare.py            existing-engine comparison (where valid)
    pipeline.py                  orchestration, pre-registered decision gates, boundary sensitivity
    report.py                    Markdown report from results.json
    synthetic.py                 synthetic datasets FOR TESTS ONLY
  tests/                         pytest suite
  requirements.txt               pinned research dependencies
  work/                          gitignored: datasets, models, reports
```

## 3. Point-in-time integrity

This is the highest-priority requirement. A stored context's timestamp proves when the context was assembled. It does not prove that every statistic inside it was valid at that time, so the design treats the context as a source of raw match observations, not as a feature vector.

| Rule | Where it is enforced |
|---|---|
| Contexts created at or after kickoff are rejected | `judgeJob` → `context_at_or_after_kickoff` |
| A context built for a different kickoff (a reschedule > 36h away) is rejected | `judgeJob` → `context_kickoff_mismatch` |
| A context whose team ids contradict the fixture is rejected | `judgeJob` → `context_team_mismatch` |
| The earliest valid pre-kickoff context is selected | `consolidateFixture` |
| Season aggregates, standings, player availability and odds are never features | audited in the manifest, never exported |
| Historical matches dated after generation are excluded | ledger availability rule |
| Same-day matches are excluded unless completion is independently verifiable | ledger: date-only sightings need recorded-at ≥ date + 28h; exact-kickoff sightings with a finished status can qualify the same day |
| Incomplete recent results are excluded | ledger → `incomplete_result` |
| Results that disagree between sightings are excluded | ledger → `score_conflict` |
| The target fixture never informs itself | ledger guard by fixture id and by (teams, UTC day), plus a runtime check per feature row |
| One fixture never appears in two partitions | one row per provider fixture id; `assert_partition_integrity` |
| No training label post-dates an evaluation forecast | label-time embargo in `splits.py` |

### The ledger

Each observation is a sighting of a completed match: an entry in a stored last-5 list, a stored head-to-head meeting, or a settlement. Each one carries the time it was recorded. Sightings of the same match are merged, and the match keeps the earliest moment it was on record.

- **`context_h2h` and `settlement`** sightings carry the exact kickoff and assert a finished status. (`trimH2H` keeps only finished, non-irregular fixtures, and settlement only records final results.)
- **`context_last5`** sightings carry a UTC date only. API-Football is called without a timezone parameter, so dates are UTC. They also carry no status. A score on a date-only record proves completion only once that whole UTC day is over, so the sighting must be recorded at least 28 hours after the date's midnight: 24 hours for the day plus a 4-hour margin for a late kickoff. Every same-day entry fails this test, and so does any entry recorded during or just after its match day.

A match is **available** to a fixture generated at time T when:

- **strict** (the default and the headline): its earliest valid sighting was recorded at or before T. Nothing BetGenius learnt later is back-filled into an earlier decision. The selected context's own last-5 is recorded at exactly T and was in hand when the engine ran.
- **completion** (sensitivity only): the match completed before T (kickoff + 3h, or date + 28h for date-only records), even if BetGenius recorded it later. This is an upper bound on what better data capture could buy. It is not a valid backtest.

## 4. Extractor

`research/forecasting/extract/extract.ts`:

1. Opens one verified read-only snapshot (section 5).
2. Reads `Prediction` rows created on or before `--as-of`. Any settlement recorded after `as_of` is masked: its score and outcome are treated as not yet known, so re-running with the same `as_of` later reproduces the dataset.
3. Pages through `AIJob` rows by id and parses each context through production's `parseStoredContext`. V1 rows are upgraded via `buildMatchDigest`, and V2 rows are read as stored. Raw V1 payloads are dropped immediately after parsing.
4. Groups prediction rows by provider fixture id. It validates team, league and kickoff identity (60-second tolerance, the same as `kickoffAssert.ts`), score consistency, settlement time, and recorded outcomes against the score via `resolveMarket`. It then selects the earliest valid pre-kickoff context.
5. Writes `fixtures.jsonl`, `observations.jsonl` and `manifest.json`. Output order is deterministic and two extractions of one snapshot are byte-identical; the integration test checks this.

Fixture exclusion codes, in check order: `team_id_missing`, `team_identity_conflict`, `team_identity_invalid`, `league_id_missing`, `league_identity_conflict`, `kickoff_missing`, `kickoff_conflict`, `final_score_missing`, `final_score_partial`, `final_score_conflict`, `settlement_time_missing`, `settled_before_kickoff`, `outcome_score_inconsistent`, `no_linked_generation_job`, `no_valid_pre_kickoff_context`.

Job verdicts: `selected`, `valid_not_earliest`, `job_not_found`, `context_missing`, `context_unparseable`, `context_at_or_after_kickoff`, `context_team_mismatch`, `context_kickoff_mismatch`.

The manifest recomputes the audit figures from the brief over the selected contexts of included fixtures. These are:

- season records for both teams
- recent matches for both teams
- standings, H2H and availability coverage
- future-dated availability
- same-day last-5 entries
- missing-score last-5 entries

The brief's figures (for example 3,512 of 4,262 with both season records, and 1,154 with future availability dates) are audit observations. The extractor reports its own counts, and those are the ones to cite.

## 5. Secure read-only execution

### Create the role (once, by a database owner)

Run against the production database by someone with owner rights. This creates a login role that can read and nothing else:

```sql
CREATE ROLE betgenius_research LOGIN PASSWORD '<generated, stored in a password manager>';
GRANT CONNECT ON DATABASE <db> TO betgenius_research;
GRANT USAGE ON SCHEMA public TO betgenius_research;
GRANT SELECT ON "Prediction", "AIJob" TO betgenius_research;   -- the only two tables read
ALTER ROLE betgenius_research SET default_transaction_read_only = on;
ALTER ROLE betgenius_research SET statement_timeout = '120s';
ALTER ROLE betgenius_research CONNECTION LIMIT 2;
```

On Neon, create the role in the console or with `neonctl roles create` and then run the `GRANT` and `ALTER ROLE` statements. If you can, point the URL at a read replica or a branch rather than the primary.

### What the extractor verifies before reading anything

The extractor reads `RESEARCH_READONLY_DATABASE_URL`, and refuses to start if:

- the variable is unset or not a postgres URL
- it equals `DATABASE_URL` or `DATABASE_URL_UNPOOLED`, even when that credential is itself read-only

Inside the session, before any data is read, it then requires all of the following:

- `transaction_read_only = on` (the transaction is opened `REPEATABLE READ, READ ONLY`)
- `default_transaction_read_only = on` on the role
- not a superuser
- **zero** tables in `public` on which the role holds INSERT, UPDATE, DELETE or TRUNCATE
- `statement_timeout` (default 60 s, `--statement-timeout-s`), `lock_timeout = 5s` and `idle_in_transaction_session_timeout = 60s` set locally, and a wall clock on the whole transaction (default 10 minutes, `--max-transaction-minutes`, at most 30)

Any failure aborts the run with a message that never includes the URL. Other error messages are scrubbed of URLs and host:port pairs. The integration test confirms that an `UPDATE` inside the session fails, that a role with write grants is refused, and that the application credential is refused.

### Handling the output

Datasets, models and reports go to `research/forecasting/work/` by default. That path is gitignored at both the repository root (`work/`) and the package level. They contain fixture ids, team ids and results, so treat them as private. Do not commit them, attach them to issues, or upload them as CI artifacts. CI never sees them: the workflow uses synthetic data only and has no secrets.

## 6. Features

There is one row per included fixture. Every value is computed from ledger matches available at generation time (`features.py`). Each team uses at most the 10 most recent matches within the last 365 days.

- **Identifiers (categorical):** `league_id`, `home_id`, `away_id`. Values seen fewer than 20 times (leagues) or 10 times (teams, pooled across home and away) in training rows become `other`, and so do unseen values. They are never numeric magnitudes.
- **League priors (point in time):** home and away goals per match, home, draw and away rates, BTTS and over-2.5 rates, home advantage in goals, and the sample size. Each is shrunk toward the all-competition average with k = 30. Below 50 ledger matches, the all-competition average falls back to conventional football priors, and the row is flagged `global_prior_conventional = 1`.
- **Team form, each side:**
  - goals for and against per match
  - win, draw and loss rates and points per game
  - scoring and clean-sheet rates
  - venue-specific goals for and against, and win rate (home side at home, away side away)

  All are shrunk toward league priors with k = 4.
- **Rest days**, capped at 30, from the latest available match. Missing when there is no history, and flagged.
- **Sample sizes and indicators:** `*_n`, `*_venue_n`, `*_no_history`, `*_rest_missing`, `league_n`, `h2h_n`.
- **Head-to-head:** goal difference per meeting over four years, shrunk to 0 with k = 3.
- **Differences** between the two sides, and the Poisson expected goals (a fixed function of the features above).
- **Timing:** hours between generation and kickoff.

Not used: player availability, standings, season aggregates, odds, and anything derived from the target fixture's result.

## 7. Models

**Model A: Poisson** (`poisson.py`). The two sides' expected goals are:

- λ_home = μ_home × attack(home) × defence(away)
- λ_away = μ_away × attack(away) × defence(home)

These come from point-in-time league means and smoothed team rates. Independent Poisson scorelines up to 10 goals each are renormalised to give 1X2, over/under 2.5 and BTTS. There are no fitted parameters, so nothing can leak. Assumptions and limitations are listed in the module and in section 13.

**Model B: XGBoost** (`xgb_model.py`). A three-class `multi:softprob` model on histogram trees:

- **Missing values:** native NaN handling, plus explicit missingness indicators.
- **Regularisation:** depth 2–4, `min_child_weight`, L2 regularisation, and 0.8 row and column subsampling.
- **Tuning:** a fixed grid of 24 configurations, scored on walk-forward folds. Early stopping uses a chronological tail of each fold's own training rows, never the fold's evaluation rows.
- **Final model:** trained on the development period minus its calibration slice, with the median tuned number of rounds.
- **Calibration:** temperature scaling, fitted on the calibration slice.
- **Reproducibility:** fixed seed and thread count; the test suite asserts bit-identical predictions and identical model hashes.
- **Artifact:** `model.json`, plus `meta.json` with features, categories, parameters, temperature, dataset hashes, runtime versions and `research_only: true`. The version is the model hash. Loading verifies the hash.

A goals-market XGBoost model is not implemented. It is the optional second experiment, and the Poisson model covers those markets as the baseline.

## 8. Chronological validation

Every partition is defined by a boundary B:

- **train:** `kickoff + 3h ≤ B` (the result was known by B)
- **eval:** `generated_at ≥ B` (the forecast was made at or after B)
- **embargoed:** everything else, used by neither

Because `generated_at < kickoff`, no fixture can be on both sides, and every training label predates every evaluation forecast. Nothing is shuffled.

- **Test:** the latest 20% of fixtures by kickoff. This period is untouched until the final evaluation.
- **Walk-forward:** 4 expanding-window folds inside the development period, used for hyperparameter selection and reported per fold. XGBoost's fold scores are optimistic because the configuration was chosen on those same folds; the report says so.
- **Calibration:** the latest 20% of the development period, after its own embargo.

## 9. Evaluation and the decision rule

The report covers:

- multiclass log loss, Brier score (range 0–2) and accuracy
- top-label and class-wise ECE, and mean forecast against observed frequency
- per-league log loss for leagues with at least 30 test fixtures
- over/under 2.5 and BTTS from Poisson against the base rate
- coverage and completeness
- 95% bootstrap intervals over fixtures with a fixed seed, and paired intervals for every model difference

**Existing-engine comparison.** The engine states one pick per market with a 0–100 confidence; it does not give a distribution. So the only valid comparison is selection-conditional: on the engine's own MATCH_WINNER, DOUBLE_CHANCE, OVER_UNDER 2.5 and BTTS picks from the selected pre-kickoff job, score the engine's raw confidence and each model's probability for that same outcome. A market with fewer than 30 picks is reported as insufficient. Engine confidence is uncalibrated, because the production calibration artifact is not applied. No profitability is measured or claimed, since no verified publication-time prices are used.

### Pre-registered decision rule

The rule is implemented in `pipeline.decision_gates` and `pipeline.recommend`, and every branch is unit-tested. Its constants were fixed before any real data was seen. Changing one after looking at a real result invalidates that result.

The rule reads **only** the primary test period: `r["status"]`, `r["test"]` and `r["coverage"]`. The boundary-sensitivity and ledger-mode sensitivity results are never consulted. The recommendation is computed before any alternative boundary is even evaluated.

**proceed** requires every one of these eight gates to pass. Each gate fails closed: a missing or non-numeric value fails it.

| Gate | Requirement |
|---|---|
| `test_size` | at least 300 fixtures in the untouched test period |
| `coverage_all` | at least 70% of **all** included fixtures have history for both teams |
| `coverage_test` | at least 70% of **test-period** fixtures have history for both teams |
| `beats_poisson_ci` | XGBoost − Poisson log loss, paired 95% CI upper bound < 0 |
| `beats_poisson_margin` | XGBoost − Poisson mean log loss ≤ −0.005 nats per match |
| `beats_base_ci` | XGBoost − base rate log loss, paired 95% CI upper bound < 0 |
| `beats_base_margin` | XGBoost − base rate mean log loss ≤ −0.005 nats per match |
| `calibration` | top-label ECE ≤ 0.05 |

Even when every gate passes, proceed means a shadow-mode comparison against live generation, never publication.

- **stop:** all three data-adequacy gates pass (`test_size`, `coverage_all`, `coverage_test`) but XGBoost does not beat the base rate (`beats_base_ci` fails). Thin data can neither approve nor condemn the model.
- **improve data:** anything else. Every failing gate is listed in the report, with its measured value.

**Why coverage is a hard gate, on both partitions.** A fixture with no history for one side is forecast from league priors alone. When coverage is low, a gain on the remaining fixtures says little about how the model would behave across what BetGenius actually publishes. The first version of this rule recorded low coverage as a reason but could still return proceed. Review caught this: proceed was returned even at 10% coverage. The fix is regression-tested.

The test-period gate exists because history accumulates over time. A dataset can reach 70% overall while its latest period, the one that decides, is thinner (or the reverse). Both must pass.

**Why a minimum practical improvement of 0.005 nats.** A paired CI below zero shows that a difference is real; it does not show that it is worth having. With several thousand test fixtures, a gain of 0.001 nats can be statistically significant and still be operationally worthless. The cost of a second forecasting engine (maintenance, monitoring, shadow comparison, explaining disagreements) is fixed, so the gain must clear a floor.

The floor is 0.005 nats per match, applied to the mean paired difference. That is exp(0.005) ≈ 1.005: on average, about 0.5% more probability placed on the outcome that actually happened. For a three-way market with log loss near 1.0, it is about 0.5% relative. That is roughly the smallest difference usually treated as meaningful between football forecasting models. It is a judgement fixed in advance, not a value fitted to data.

The existing CI requirement is kept unchanged. The margin is applied to the point estimate, not to the CI bound, because a CI-bound version (upper bound < −0.005) would be far stricter. In the synthetic benchmark, the paired XGBoost − Poisson 95% CI on about 860 test fixtures spans roughly ±0.022 nats. A CI-bound margin would therefore need a true gain of about 0.027 nats, several times larger than realistic improvements between competent models. The point-estimate margin plus a CI excluding zero is the pre-registered compromise.

### Sensitivity to the test boundary (reporting only)

The primary test boundary is the latest 20% of fixtures; it is pre-registered as `PRIMARY_TEST_FRACTION`. By default the report also re-runs the whole protocol with the latest 15%, 25% and 30% as test periods. Each alternative is fully independent:

- its own split and embargo
- its own walk-forward tuning on its own development period
- its own calibration slice

Nothing is reused from the primary run, whose development period overlaps the larger alternatives' test periods. Reusing its tuned parameters would leak.

The alternatives do not train the final model, choose its parameters, or produce the artifact. They do not feed `recommend()`. A test asserts that the model hash, test scores and recommendation are identical with and without them.

The report shows each boundary's test window, size, coverage and log losses, and the XGBoost − Poisson and XGBoost − base-rate paired CIs. It also summarises the XGBoost-versus-Poisson verdicts (better, worse or inconclusive) across boundaries. A primary proceed that the alternatives contradict should be watched closely in shadow mode, but it is not overturned. Letting the alternatives vote would reintroduce the selection the protocol is designed to prevent.

Overriding `--test-fraction` is allowed for exploration. The run is then marked `test_fraction_overridden`, and the report opens with a **protocol deviation** warning.

## 10. Running it

The preferred real run is one command on an isolated machine, given a verified dump (section 11):

```bash
python3 -m venv research/forecasting/.venv && research/forecasting/.venv/bin/pip install -r research/forecasting/requirements.txt
bash research/forecasting/restore/isolated-run.sh --dump /secure/path/betgenius.dump      # -> research/forecasting/work/real-<stamp>/
```

The manual steps, for a read replica or Neon branch instead of a dump:

```bash
# 1. Extract (by hand, outside CI, with the research role; see section 11 for where to run it)
RESEARCH_READONLY_DATABASE_URL='postgresql://betgenius_research:…@…/…?sslmode=require' \
  npm run research:extract -- --out research/forecasting/work/dataset-2026-11-14 --as-of 2026-11-14T00:00:00Z \
  --page-size 50 --page-delay-ms 100          # the shared-VPS profile; the npm script caps the Node heap at 384 MiB

# 2. Model and report (boundary sensitivity runs by default; --no-boundary-sensitivity skips it)
cd research/forecasting
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
nice -n 19 .venv/bin/python -m bgforecast run --dataset work/dataset-2026-11-14 --out work/run-2026-11-14 --sensitivity --threads 2
# -> work/run-2026-11-14/report.md, results.json, test_predictions.csv, model/

# Validate a dataset on its own (the pipeline also runs this and refuses to train on failure)
.venv/bin/python -m bgforecast validate --dataset work/dataset-2026-11-14 --require-real

# Tests (synthetic only)
npm run check:research-extract
BGF_PYTHON=$PWD/research/forecasting/.venv/bin/python bash research/forecasting/restore/check-isolated-run.sh
bash research/forecasting/extract/integration/run-local-integration.sh   # needs local postgres binaries
cd research/forecasting && .venv/bin/python -m pytest -q
```

## 11. Dependencies and resources

- **Python ≥ 3.12:** `xgboost 3.0.5`, `numpy 2.3.4`, `pandas 2.3.3`, `scipy 1.16.3` and `pytest 8.4.2` (pinned in `requirements.txt`). None of these are application dependencies, and nothing is added to `package.json` dependencies.
- **Node:** the repository's existing toolchain (`tsx`, `@prisma/client`). The extractor adds two npm scripts and no packages.
- **Database load:** a single connection (`connection_limit=1`), one snapshot transaction, and a sequential scan of `Prediction` plus a keyset-paged scan of `AIJob`.

### Shared-VPS review and safe execution limits

**The host** (docs/VPS_MIGRATION.md, deploy/docker-compose.yml) is a Contabo Cloud VPS 6 shared with School Kit: 6 vCPU, 12 GB RAM and 4 GB swap. BetGenius's containers are capped as follows:

- app: 1 GB and 2 CPUs
- Postgres 17: 768 MB, with `shared_buffers` at 192 MB and no CPU cap
- ops: 256 MB

The research tools are not containers, so **nothing caps them unless you do**. Nothing in this PR changes the server, compose or Postgres settings.

**Measured costs.** These were measured on synthetic data at production-like volume, on a 4-CPU container.

| Step | Setting | Wall time | Peak memory | Notes |
|---|---|---|---|---|
| Extract | page 200 (the old default), no heap cap | 8–10 s | 1,025 MiB | Too much for a shared host. Parsed JSON costs several times its raw size, and Node's heap grows lazily. |
| Extract | page 50, no heap cap | 7 s | 524 MiB | |
| Extract | **page 50, heap cap 384 MiB (the npm script default)** | 7 s | 402 MiB | The new default |
| Extract | page 25, heap cap 256 MiB, 100 ms page delay | 28 s | 331 MiB | The gentlest profile |
| Postgres during extraction | VPS settings (`shared_buffers` 192 MB) | — | about 290 MiB total across server processes | Within the 768 MB container limit |
| Train | full grid, boundary and ledger-mode sensitivity, **2 threads** | 222 s (primary fit 50 s; three independent boundary runs 163 s) | 360 MiB | |
| Train | full grid, ledger-mode sensitivity, no boundary sensitivity, 4 threads | 49 s | 372 MiB | |

The extraction volume was 4,400 fixture ids, 5,150 jobs (1,500 V1 contexts padded to about 150 KB each with incompressible content) and 7,900 predictions: 179 MB of `AIJob` on disk. The training dataset had 4,340 included fixtures and 54,753 observations. Reproduce with `bash research/forecasting/extract/integration/bench-local-extract.sh` and a `bgforecast run` on a `synth` dataset of `--leagues 8 --teams 20`.

**Where to run extraction, in order of preference:**

1. **Off the live database entirely (preferred).** Restore the two tables needed from a dump into a throwaway Postgres on an isolated machine, then extract from that. This has zero load on production and zero buffer-cache disruption.

   Use the one-command runner, which does every step below and tears the scratch database down afterwards:

   ```bash
   bash research/forecasting/restore/isolated-run.sh --dump /secure/path/betgenius.dump
   ```

   The runner:
   - refuses to run on the production VPS
   - verifies the dump, including that its `pg_dump` version is no newer than the local Postgres
   - restores **only** `Prediction` and `AIJob`
   - drops the prompt, raw-output and prose columns
   - creates the read-only role from section 5
   - extracts with `--as-of` set to the dump's creation time
   - destroys the cluster, then validates and evaluates

   It is tested end to end by `restore/check-isolated-run.sh` on a synthetic dump. See docs/research/REAL_DATA_READINESS_2026-11-14.md for whether a usable dump currently exists.

   If restoring by hand, note the quoting. **`pg_restore -t` matches names literally**: `pg_restore -t Prediction -t AIJob` is correct, while `-t '"Prediction"'` matches nothing *and still exits 0*, silently restoring an empty database. (An earlier version of this document showed the quoted form; that was wrong.) **`pg_dump -t` is the opposite**: it takes a pattern, so a mixed-case name must be quoted, as in `pg_dump -t '"Prediction"' -t '"AIJob"'`.

   Production runs Postgres 17, so its dumps need Postgres 17 client and server binaries on the isolated machine. An older `pg_restore` cannot read them, and the runner refuses rather than half-restoring. The dump contains production data: keep it on an encrypted disk and out of the repository.
2. **A Neon branch or read replica**, if the database is still on Neon.
3. **The live VPS Postgres, only if 1 and 2 are unavailable.** Use the gentlest profile (`--page-size 25 --page-delay-ms 100`, with the npm script's heap cap), off-peak — not during the settlement or generation cron windows. Expect about 30 seconds of snapshot.

   Reading about 180 MB of `AIJob` through a 192 MB buffer cache will evict most of the application's hot pages once. The application's next queries then come from disk. A long `REPEATABLE READ` snapshot also holds back vacuum for its duration. That is why the transaction wall clock defaults to 10 minutes, with a 60 s statement timeout and a 5 s lock timeout.

**Where to run training.** Anywhere except the VPS is preferable: it needs only the dataset files, and any machine with 2 CPUs and 1 GB free will do. If it must run on the VPS, cap it so it cannot squeeze School Kit or the BetGenius app:

```bash
systemd-run --user --scope -p MemoryMax=1G -p CPUQuota=200% \
  nice -n 19 ionice -c3 .venv/bin/python -m bgforecast run --dataset … --out … --threads 2
```

`--threads` defaults to 2 (`BGF_THREADS` overrides it), matching the app container's own CPU cap. Never run with more threads than 2 on the shared host. The extractor needs about 400 MiB under the npm script's heap cap, so cap it the same way:

```bash
systemd-run --user --scope -p MemoryMax=768M nice -n 19 npm run research:extract -- …
```

If the heap cap is reached, Node aborts with an out-of-memory error. That is a clean failure, not host memory pressure. Rerun with a smaller `--page-size`.

**Limits in force:**

| Limit | Value |
|---|---|
| Extractor page size | default 50 (10–1000) |
| Extractor Node heap | 384 MiB via `npm run research:extract` |
| Extractor statement timeout | 60 s (5–300) |
| Extractor snapshot wall clock | 10 min (1–30) |
| Database connections | 1, plus the role's own `CONNECTION LIMIT 2` |
| XGBoost threads | 2 by default |
| Training memory | measured at about 360–370 MiB; cap at 1 GB |

Fixed thread counts give bit-identical results. Compare runs at the same thread count; the count is recorded in the model artifact.

## 12. Tests

| Suite | What it covers |
|---|---|
| `npm run check:research-extract` | Duplicate fixture rows; earliest valid pre-kickoff context; contexts at or after kickoff; team, league, kickoff and score conflicts; partial and missing scores; settlement timing; outcome against score; V1 and V2 parsing via production code; observation orientation; missing opponents; same-day, future-dated and incomplete audit counts; future availability; engine rows scoped to the selected job; deterministic and order-independent output; every read-only posture and credential refusal, including that refusals never echo the credential. |
| `extract/integration/run-local-integration.sh` | A real Postgres 16 with the real schema. Refuses the app credential and a role with write grants; an UPDATE inside the session fails; real extraction through a read-only role; V1 context; `--as-of` masking; byte-identical re-extraction. |
| `pytest` (`research/forecasting/tests`) | The ledger's same-day, 28h and exact-kickoff rules; strict versus completion modes; target exclusion; duplicate merging; score conflicts; missing data. **Leakage invariance:** rewriting every result unknowable at generation time leaves features bit-identical across 30 fixtures and more than 1,000 tampered sightings, with a positive control. Shrinkage and priors; identifiers stay categorical. Partitions are disjoint, label-safe, ordered and non-random, and the integrity check fires on a planted violation. Poisson probabilities are checked against closed forms. Temperature scaling. XGBoost probabilities are valid with NaNs present. Bit-identical retraining and artifact hashes, with artifact tamper detection. Bit-identical end-to-end pipeline runs. Dataset hash, schema and duplicate refusals. The synthetic report banner. **Decision rule:** every branch. Low coverage, overall or in the test period alone, blocks proceed even with excellent results. Missing or NaN coverage and calibration fail closed. Coverage and margin thresholds are inclusive. A significant but negligible gain is not proceed, and the CI requirement still applies. An exhaustive grid of 432 combinations checks that proceed implies every gate passed. Sensitivity results cannot change the recommendation. Boundary sensitivity leaves the final model hash, test scores and recommendation bit-identical. An end-to-end run with zero coverage cannot proceed. An overridden test fraction is flagged. |
| `restore/check-isolated-run.sh` | 36 checks on a synthetic dump with a canary user e-mail and canary prompt. **Refusals:** deployment directories, BetGenius or School Kit containers and compose projects, the `edge` network, a listener on the VPS Postgres port, a dump without `AIJob` data, an unreadable dump, output outside the work tree, an existing output directory (left untouched), and a dump newer than the local Postgres (version shim derived from the real binaries). **Isolation:** a socket-only cluster whose own data directory is verified, and a decoy Postgres on the old fixed port with a hostile `PG*` environment that receives no connection. **Cleanup:** injected failures at restore, extract, validate and evaluate, a truncated dump, and SIGTERM mid-run each leave no scratch directory, no process and no outputs; `--keep-failed-outputs` keeps outputs but still destroys the cluster. **Full run:** the two-table restore, read-only snapshot, validation, the eight gates, both sensitivity analyses, provenance and the thread cap. **Secrets:** no generated password, connection string, inherited password or canary in any log or output, and nothing stray left in the work tree. |
| `restore/check-fetch-and-run.sh` | A fake rclone serving a synthetic dump. **Refusals, each with no download made:** the production host, production backup credentials, missing read-only credentials, a remote without `no_check_bucket`, Postgres older than 17, a secure directory inside the repository, undetected encryption without confirmation, and a path-traversal key. **Downloads:** size and SHA mismatch and a download error each leave nothing behind, and errors never show the endpoint or bucket. **Runs:** a failure inside the run deletes the dump and scratch data. A full run writes a report and a receipt, keeps the scratch database on the secure volume, and leaves the secure directory empty. `--keep-dump` keeps the dump at mode 0600. **Leaks:** no credential value, bucket path, endpoint or canary in any log or output. |
| CI job `restore-postgres-17` | PGDG Postgres 17 and 18 on `ubuntu-24.04`: the isolated-run check with a 17 dump restored by 17 (the production case), and with a 17 dump restored by 18, plus the fetch check on 17. |
| `pytest tests/test_validate.py` | Each hard integrity check fires on a planted defect: generation at kickoff, settlement before kickoff, engine row after kickoff, observation after `as_of`, excluded without a reason, count mismatch, an unverified snapshot, and `--require-real` on synthetic data. The pipeline refuses to train on an invalid dataset. |
| `extract/integration/bench-local-extract.sh` | Not a pass/fail test. It measures extractor wall time, snapshot duration and peak memory, and Postgres memory, at production-like volume on a VPS-configured local Postgres (section 11). |

Mutation checks were run while developing:

- Removing the ledger's time cut-off fails 20 tests.
- The original `recommend()` from `ec0d5d9` returns proceed at 10% coverage and for a significant but negligible 0.003-nat gain. The new tests reject both.

## 13. Limitations

- **No real-world result exists yet.** The pipeline must be run against a real extraction before anything can be said about BetGenius data.
- **Thin histories.** Team history is reconstructed from what stored contexts sighted (five matches per team per context) and from settlements. Teams BetGenius rarely covered will have thin histories; the report measures this rather than assuming it.
- **Strict mode is pessimistic.** It uses only results that were on record in BetGenius, which is the honest test of what the engine could have known. The completion-mode sensitivity run shows how much is lost.
- **Abandoned matches.** Last-5 entries carry no status, so an abandoned match with a partial score would be read as a result if no h2h or settlement sighting contradicts it.
- **Poisson simplifications.** The model assumes independent home and away goals (no Dixon–Coles correction for low-score draws). It ignores opponent strength within each recent window, and counts cup and European matches at face value.
- **Engine comparison.** It is selection-conditional and uses uncalibrated engine confidence.
- **Excluded inputs.** Season aggregates, standings, availability and odds are excluded until their point-in-time validity can be established. Some of them may hold signal.
- **Recent-results features only.** There is no Elo or other rating system, and no goals-market XGBoost model; both are natural next experiments if the first result warrants it.
- **The decision thresholds are judgements.** The 70% coverage, 0.005-nat margin, 300-fixture and 0.05 ECE thresholds are reasoned in section 9, not derived from BetGenius data. They are fixed now so they cannot be fitted later.
- **Coverage is measured as "any history for both teams".** A team with one prior match counts as covered. The report also gives the share with at least five matches per side, which is worth reading alongside the gate.
- **The boundary sensitivity is not a significance correction.** Three alternative boundaries are reported for stability, not combined into a test. Their test periods overlap the primary one, so they are not independent evidence.
- **Resource figures are synthetic.** They come from synthetic data at production-like volume. Real V1 payload sizes vary, and the first real extraction should be watched with the measurements in section 11.
