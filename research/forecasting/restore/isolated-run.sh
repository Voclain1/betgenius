#!/usr/bin/env bash
# Real-data research run from a pg_dump file, in complete isolation.
#
#   bash research/forecasting/restore/isolated-run.sh --dump /secure/betgenius-YYYY-MM-DDTHHMMZ.dump \
#        [--out research/forecasting/work/real-<stamp>] [--as-of <ISO>] [--threads 2] [--extract-only] [--quick]
#
# What it does, in order. Any failure stops the run and tears everything down.
#   1. Refuses to run on the production VPS (it looks for the BetGenius and
#      School Kit deployments) — this must never compete with live services.
#   2. Verifies the dump: readable, a custom-format pg_dump, carries TABLE DATA
#      for "Prediction" and "AIJob", and was written by a pg_dump no newer than
#      the local pg_restore and server (a Postgres 17 dump needs 17 binaries).
#      Records its SHA-256 and header.
#   3. Creates a THROWAWAY Postgres cluster in a private temp directory,
#      listening on localhost only.
#   4. Restores ONLY the "Prediction" and "AIJob" tables (no User, payment or
#      subscription data is ever restored), then checks both are non-empty.
#   5. Drops columns the extractor never reads (prompts, raw model output,
#      reasoning prose), so the scratch copy holds the minimum.
#   6. Creates the read-only research role exactly as documented, and runs the
#      merged extractor through it (the extractor re-verifies read-only posture).
#   7. Destroys the cluster as soon as extraction ends.
#   8. Validates the dataset (--require-real) and, unless --extract-only, runs
#      the pre-registered evaluation at low priority with a bounded thread count.
#   9. Writes run-provenance.json (dump hash and header, row counts, versions,
#      git commit, timings) next to the outputs.
#
# Outputs go under research/forecasting/work/ (gitignored). They contain
# production-derived data: keep them on an encrypted disk, never commit them.
# The dump file itself is never modified or deleted.
set -euo pipefail

DUMP=""; OUT=""; AS_OF=""; THREADS=2; EXTRACT_ONLY=0; QUICK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dump) DUMP="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --as-of) AS_OF="$2"; shift 2 ;;
    --threads) THREADS="$2"; shift 2 ;;
    --extract-only) EXTRACT_ONLY=1; shift ;;
    --quick) QUICK=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
die() { echo "REFUSED: $*" >&2; exit 1; }
step() { echo; echo "── $*"; }

[ -f package.json ] && [ -d research/forecasting ] || die "run from the repository root"
[ -n "$DUMP" ] || die "--dump <file> is required"
[ -f "$DUMP" ] || die "dump file not found: $DUMP"
case "$THREADS" in ''|*[!0-9]*) die "--threads must be a positive integer" ;; esac
[ "$THREADS" -ge 1 ] && [ "$THREADS" -le 4 ] || die "--threads must be between 1 and 4"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="${OUT:-research/forecasting/work/real-$STAMP}"
case "$(realpath -m "$OUT")" in "$(realpath research/forecasting/work)"/*) ;; *) die "--out must be inside research/forecasting/work (gitignored)";; esac
PY="${BGF_PYTHON:-research/forecasting/.venv/bin/python}"
[ -x "$PY" ] || die "Python environment not found at $PY (python3 -m venv research/forecasting/.venv && research/forecasting/.venv/bin/pip install -r research/forecasting/requirements.txt), or set BGF_PYTHON"
# Absolute, but NOT symlink-resolved: a venv python is a symlink, and resolving it drops the venv.
PY="$(cd "$(dirname "$PY")" && pwd)/$(basename "$PY")"; OUT=$(realpath -m "$OUT")
T0=$(date +%s)

# ── 1. never on the production server ──────────────────────────────────────
step "1. host check"
# PROD_MARKERS is overridable only so the refusal itself can be tested.
for marker in ${PROD_MARKERS:-/opt/betgenius /opt/school-kit}; do
  [ ! -e "$marker" ] || die "$marker exists: this looks like the production VPS. Run on an isolated machine (docs section 11)."
done
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qiE 'betgenius|school'; then
  die "BetGenius or School Kit containers are running on this host. Run on an isolated machine."
fi
unset DATABASE_URL DATABASE_URL_UNPOOLED RESEARCH_READONLY_DATABASE_URL
echo "   not the production host; application database variables cleared for this run"

# ── 2. verify the dump ─────────────────────────────────────────────────────
step "2. dump verification"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PG_BIN/pg_restore" ] && [ -x "$PG_BIN/initdb" ] || die "Postgres server binaries not found (set PG_BIN)"
TOC=$("$PG_BIN/pg_restore" -l "$DUMP" 2>&1) || die "pg_restore cannot read the dump: $(echo "$TOC" | head -2)"
DUMP_PGDUMP_MAJOR=$(echo "$TOC" | sed -n 's/^;[[:space:]]*Dumped by pg_dump version: \([0-9]*\).*/\1/p')
DUMP_SERVER_MAJOR=$(echo "$TOC" | sed -n 's/^;[[:space:]]*Dumped from database version: \([0-9]*\).*/\1/p')
LOCAL_MAJOR=$("$PG_BIN/pg_restore" --version | sed 's/[^0-9]*\([0-9]*\).*/\1/')
[ -n "$DUMP_PGDUMP_MAJOR" ] || die "dump header has no pg_dump version"
[ "$LOCAL_MAJOR" -ge "$DUMP_PGDUMP_MAJOR" ] || die "dump written by pg_dump $DUMP_PGDUMP_MAJOR; local Postgres is $LOCAL_MAJOR. Install Postgres $DUMP_PGDUMP_MAJOR server binaries and set PG_BIN."
[ "$LOCAL_MAJOR" -ge "${DUMP_SERVER_MAJOR:-0}" ] || die "dump is from server $DUMP_SERVER_MAJOR; local server is $LOCAL_MAJOR"
echo "$TOC" | grep -qE '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA public Prediction ' || die "dump has no TABLE DATA for public.\"Prediction\""
echo "$TOC" | grep -qE '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA public AIJob ' || die "dump has no TABLE DATA for public.\"AIJob\""
ARCHIVE_CREATED=$(echo "$TOC" | sed -n 's/^; Archive created at \(.*\)$/\1/p')
DUMP_SHA=$(sha256sum "$DUMP" | cut -d' ' -f1)
DUMP_BYTES=$(wc -c < "$DUMP")
if [ -z "$AS_OF" ]; then
  AS_OF=$(date -u -d "$ARCHIVE_CREATED" +%Y-%m-%dT%H:%M:%SZ) || die "cannot parse the dump's creation time; pass --as-of"
fi
echo "   sha256 $DUMP_SHA, $DUMP_BYTES bytes, created $ARCHIVE_CREATED"
echo "   pg_dump $DUMP_PGDUMP_MAJOR / server $DUMP_SERVER_MAJOR; local $LOCAL_MAJOR; as_of $AS_OF"

# ── 3. throwaway cluster ───────────────────────────────────────────────────
step "3. throwaway cluster"
WORK=$(mktemp -d)
chmod 700 "$WORK"
RUN=(); PG_OS_USER="$(id -un)"
if [ "$(id -u)" = "0" ]; then
  id -u pgresearch >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin pgresearch
  chown pgresearch "$WORK"; RUN=(runuser -u pgresearch --); PG_OS_USER=pgresearch
fi
PORT="${RESEARCH_PG_PORT:-55499}"
teardown() {
  if [ -d "$WORK" ]; then
    "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$WORK"
    echo "   throwaway cluster destroyed"
  fi
}
trap teardown EXIT
SU_PW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
RO_PW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
printf '%s\n' "$SU_PW" > "$WORK/supw"; chmod 600 "$WORK/supw"; [ ${#RUN[@]} -eq 0 ] || chown pgresearch "$WORK/supw"
"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U research_admin --auth=scram-sha-256 --pwfile="$WORK/supw" >/dev/null
rm -f "$WORK/supw"
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -l "$WORK/pg.log" -w start \
  -o "-p $PORT -k $WORK -c listen_addresses=localhost -c shared_buffers=128MB -c max_connections=10" >/dev/null
export PGPASSWORD="$SU_PW"
PSQL=("$PG_BIN/psql" -h localhost -p "$PORT" -U research_admin -v ON_ERROR_STOP=1 -qAt)
"${PSQL[@]}" -d postgres -c "CREATE DATABASE research"
echo "   localhost:$PORT, private directory, scram passwords generated for this run only"

# ── 4. restore the two tables only ─────────────────────────────────────────
step "4. restore Prediction and AIJob only"
R0=$(date +%s)
# Unquoted names: pg_restore matches -t literally, so '"Prediction"' would match nothing (and exit 0).
"$PG_BIN/pg_restore" --no-owner --no-privileges --exit-on-error -t Prediction -t AIJob \
  -h localhost -p "$PORT" -U research_admin -d research "$DUMP"
TABLES=$("${PSQL[@]}" -d research -c "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'")
[ "$TABLES" = "AIJob,Prediction" ] || die "unexpected tables after restore: $TABLES"
N_PRED=$("${PSQL[@]}" -d research -c 'SELECT count(*) FROM "Prediction"')
N_JOB=$("${PSQL[@]}" -d research -c 'SELECT count(*) FROM "AIJob"')
[ "$N_PRED" -gt 0 ] && [ "$N_JOB" -gt 0 ] || die "restored tables are empty (Prediction=$N_PRED, AIJob=$N_JOB)"
RESTORE_S=$(( $(date +%s) - R0 ))
echo "   Prediction $N_PRED rows, AIJob $N_JOB rows, ${RESTORE_S}s"

# ── 5. data minimisation ───────────────────────────────────────────────────
step "5. drop columns the extractor never reads"
"${PSQL[@]}" -d research <<'SQL'
ALTER TABLE "AIJob" DROP COLUMN IF EXISTS prompt, DROP COLUMN IF EXISTS "rawOutput", DROP COLUMN IF EXISTS "reviewerNote";
ALTER TABLE "Prediction" DROP COLUMN IF EXISTS reasoning, DROP COLUMN IF EXISTS "matchPreview", DROP COLUMN IF EXISTS "analysisJson",
  DROP COLUMN IF EXISTS "previousDrafts", DROP COLUMN IF EXISTS "settlementNote";
SQL
echo "   prompts, raw model output, reasoning prose and draft history removed from the scratch copy"

# ── 6. read-only role and extraction ───────────────────────────────────────
step "6. read-only role and extraction"
"${PSQL[@]}" -d research <<SQL
CREATE ROLE betgenius_research LOGIN PASSWORD '$RO_PW';
GRANT CONNECT ON DATABASE research TO betgenius_research;
GRANT USAGE ON SCHEMA public TO betgenius_research;
GRANT SELECT ON "Prediction", "AIJob" TO betgenius_research;
ALTER ROLE betgenius_research SET default_transaction_read_only = on;
ALTER ROLE betgenius_research SET statement_timeout = '120s';
ALTER ROLE betgenius_research CONNECTION LIMIT 2;
SQL
mkdir -p "$OUT"
E0=$(date +%s)
RESEARCH_READONLY_DATABASE_URL="postgresql://betgenius_research:$RO_PW@localhost:$PORT/research" \
  node --max-old-space-size=384 --import tsx research/forecasting/extract/extract.ts \
  --out "$OUT/dataset" --as-of "$AS_OF" --page-size 50 | tee "$OUT/extract.log"
EXTRACT_S=$(( $(date +%s) - E0 ))
unset PGPASSWORD

# ── 7. destroy the scratch database now that the dataset exists ────────────
step "7. teardown"
teardown
trap - EXIT

# ── 8. validate and evaluate ───────────────────────────────────────────────
step "8. validation"
( cd research/forecasting && "$PY" -m bgforecast validate --dataset "$OUT/dataset" --require-real ) | tee "$OUT/validation.log"
TRAIN_S=0
if [ "$EXTRACT_ONLY" = "0" ]; then
  step "9. pre-registered evaluation (nice 19, $THREADS threads)"
  T1=$(date +%s)
  EXTRA=(); [ "$QUICK" = "1" ] && EXTRA=(--quick)
  ( cd research/forecasting && nice -n 19 "$PY" -m bgforecast run --dataset "$OUT/dataset" --out "$OUT/run" \
      --sensitivity --threads "$THREADS" --require-real "${EXTRA[@]}" ) | tee "$OUT/run.log"
  TRAIN_S=$(( $(date +%s) - T1 ))
fi

# ── provenance ─────────────────────────────────────────────────────────────
cat > "$OUT/run-provenance.json" <<JSON
{
  "dump": {"sha256": "$DUMP_SHA", "bytes": $DUMP_BYTES, "archive_created": "$ARCHIVE_CREATED", "pg_dump_major": $DUMP_PGDUMP_MAJOR, "server_major": ${DUMP_SERVER_MAJOR:-null}},
  "as_of": "$AS_OF",
  "restored_rows": {"Prediction": $N_PRED, "AIJob": $N_JOB},
  "local_postgres_major": $LOCAL_MAJOR,
  "git_commit": "$(git rev-parse HEAD)",
  "threads": $THREADS, "quick_grid": $([ "$QUICK" = "1" ] && echo true || echo false), "extract_only": $([ "$EXTRACT_ONLY" = "1" ] && echo true || echo false),
  "seconds": {"restore": $RESTORE_S, "extract": $EXTRACT_S, "train_and_report": $TRAIN_S, "total": $(( $(date +%s) - T0 ))}
}
JSON
echo; echo "done: $OUT (report: $OUT/run/report.md). Production-derived data: keep private."
