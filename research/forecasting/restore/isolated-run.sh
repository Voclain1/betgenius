#!/usr/bin/env bash
# Real-data research run from a pg_dump file, in complete isolation.
#
#   bash research/forecasting/restore/isolated-run.sh --dump /secure/betgenius-YYYY-MM-DDTHHMMZ.dump \
#        [--out research/forecasting/work/real-<stamp>] [--as-of <ISO>] [--threads 2] [--extract-only] [--quick]
#        [--keep-failed-outputs]
#
# Stages (the failing stage is named on exit; every failure tears everything down):
#   host      refuse anything that looks like the production VPS: deployment
#             directories, BetGenius / School Kit containers or compose projects,
#             School Kit's "edge" network, or a listener on port 5433 (the VPS
#             Postgres's host port). Runs before the dump is even opened.
#   dump      readable custom-format pg_dump with TABLE DATA for "Prediction" and
#             "AIJob", written by a pg_dump no newer than the local Postgres
#             (production is 17: a 17 dump needs 17 binaries). SHA-256 recorded.
#   cluster   a throwaway cluster in a private 0700 temp directory that listens on
#             a UNIX SOCKET ONLY (listen_addresses=''), so it cannot collide with,
#             or be confused for, any other instance on this machine. Every
#             connection goes to that socket path, and the script then verifies
#             it is talking to its own data directory. Inherited PG* environment
#             variables are cleared so nothing defaults to another server.
#   restore   ONLY "Prediction" and "AIJob"; no User, payment or subscription data.
#   minimise  drop prompt, raw-output and prose columns the extractor never reads.
#   extract   documented read-only role; the merged extractor (384 MiB heap, page 50).
#   teardown  the cluster is destroyed as soon as the dataset exists.
#   validate  bgforecast validate --require-real.
#   evaluate  the pre-registered evaluation at nice 19 with a bounded thread count.
#
# On ANY failure or interruption: the cluster is stopped and deleted, and the
# incomplete output directory (production-derived) is deleted unless
# --keep-failed-outputs is given. The output directory must not already exist.
#
# Logging: passwords live only in a 0600 passfile, SQL fed on stdin and the
# extractor's environment, never in argv or logs. Database error text (which
# can quote row data) is captured inside the private directory and reduced to a
# one-line scrubbed summary. All tee'd logs pass through the same scrubber.
#
# BGF_TEST_* variables are test seams used by check-isolated-run.sh only; any of
# them being set is announced loudly at start.
set -Eeuo pipefail

DUMP=""; OUT=""; AS_OF=""; THREADS=2; EXTRACT_ONLY=0; QUICK=0; KEEP_FAILED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dump) DUMP="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --as-of) AS_OF="$2"; shift 2 ;;
    --threads) THREADS="$2"; shift 2 ;;
    --extract-only) EXTRACT_ONLY=1; shift ;;
    --quick) QUICK=1; shift ;;
    --keep-failed-outputs) KEEP_FAILED=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

STAGE="arguments"; WORK=""; OUT_CREATED=0; RUN=(); CLUSTER_STARTED=0
die() { echo "REFUSED: $*" >&2; exit 1; }
step() { STAGE="$1"; echo; echo "── $1: $2"; }
# Remove anything that looks like a credential or connection string.
scrub() { sed -E 's#postgres(ql)?://[^[:space:]]+#<redacted-url>#g; s/\b[0-9a-f]{48}\b/<redacted>/g; s/(PASSWORD|password)[[:space:]]*'"'"'[^'"'"']*'"'"'/\1 <redacted>/g'; }
# One scrubbed line from a captured database error: drop DETAIL/CONTEXT/LINE lines, which can quote row data.
summarise_err() { grep -vE '^(DETAIL|CONTEXT|LINE|HINT|QUERY)|^[[:space:]]' "$1" 2>/dev/null | head -1 | cut -c1-200 | scrub; }
inject() {
  if [ "${BGF_TEST_PAUSE_AT:-}" = "$1" ]; then echo "   (test hook) paused at $1"; sleep 60 & wait $!; fi   # interruptible by INT/TERM
  if [ "${BGF_TEST_FAIL_AT:-}" = "$1" ]; then echo "   (test hook) injected failure at $1" >&2; return 1; fi
}

teardown_cluster() {
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then
    if [ "$CLUSTER_STARTED" = "1" ]; then
      "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate -w stop >/dev/null 2>&1 || true
      # Belt and braces: nothing may keep running from the scratch directory.
      pkill -9 -f -- "-D $WORK/data" >/dev/null 2>&1 || true
    fi
    rm -rf "$WORK"
    echo "   throwaway cluster destroyed ($WORK)"
  fi
  WORK=""
}
on_exit() {
  local code=$?
  trap - EXIT INT TERM
  jobs -p | xargs -r kill 2>/dev/null || true   # e.g. a paused test-hook sleep
  teardown_cluster
  if [ "$code" -ne 0 ]; then
    if [ "$OUT_CREATED" = "1" ] && [ "$KEEP_FAILED" = "0" ]; then
      rm -rf "$OUT"
      echo "   incomplete outputs removed ($OUT)" >&2
    fi
    echo "FAILED at stage: $STAGE (exit $code)" >&2
  fi
  exit "$code"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for v in $(env | sed -n 's/^\(BGF_TEST_[A-Z_]*\)=.*/\1/p'); do echo "!! TEST HOOK ACTIVE: $v — never set this for a real run" >&2; done

[ -f package.json ] && [ -d research/forecasting ] || die "run from the repository root"
[ -n "$DUMP" ] || die "--dump <file> is required"
case "$THREADS" in ''|*[!0-9]*) die "--threads must be a positive integer" ;; esac
[ "$THREADS" -ge 1 ] && [ "$THREADS" -le 4 ] || die "--threads must be between 1 and 4"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="${OUT:-research/forecasting/work/real-$STAMP}"
WORK_ROOT=$(realpath -m research/forecasting/work)
OUT=$(realpath -m "$OUT")
case "$OUT" in "$WORK_ROOT"/*) ;; *) die "--out must be inside research/forecasting/work (gitignored)";; esac
[ ! -e "$OUT" ] || die "output directory already exists: $OUT (refusing to overwrite; choose a new --out)"
PY="${BGF_PYTHON:-research/forecasting/.venv/bin/python}"
[ -x "$PY" ] || die "Python environment not found at $PY (python3 -m venv research/forecasting/.venv && research/forecasting/.venv/bin/pip install -r research/forecasting/requirements.txt), or set BGF_PYTHON"
# Absolute, but NOT symlink-resolved: a venv python is a symlink, and resolving it drops the venv.
PY="$(cd "$(dirname "$PY")" && pwd)/$(basename "$PY")"
# Nothing inherited may point a client at another server.
unset DATABASE_URL DATABASE_URL_UNPOOLED RESEARCH_READONLY_DATABASE_URL \
      PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE PGSSLMODE PGOPTIONS
T0=$(date +%s)

# ── host ───────────────────────────────────────────────────────────────────
step host "refuse the production VPS"
listening_on() { # $1 = port; reads /proc so it needs no ss/netstat
  # Only files that exist are read: a missing /proc/net/tcp6 (IPv6 disabled) must not make this
  # fail open, which a `cat a b | awk` pipeline under pipefail would.
  local hex f files=()
  hex=$(printf '%04X' "$1")
  for f in /proc/net/tcp /proc/net/tcp6; do [ -r "$f" ] && files+=("$f"); done
  [ ${#files[@]} -gt 0 ] || die "cannot read /proc/net/tcp to check for production listeners"
  awk -v p=":$hex" '$4 == "0A" && substr($2, length($2) - 4) == p { found = 1 } END { exit !found }' "${files[@]}"
}
for marker in ${BGF_TEST_PROD_MARKERS:-/opt/betgenius /opt/school-kit /opt/schoolkit}; do
  [ ! -e "$marker" ] || die "$marker exists: this looks like the production VPS. Run on an isolated machine (docs section 11)."
done
DOCKER="${BGF_TEST_DOCKER:-docker}"
if command -v "$DOCKER" >/dev/null 2>&1; then
  if "$DOCKER" ps --format '{{.Names}} {{.Label "com.docker.compose.project"}}' 2>/dev/null | grep -qiE 'betgenius|school'; then
    die "BetGenius or School Kit containers are running on this host. Run on an isolated machine."
  fi
  if "$DOCKER" network ls --format '{{.Name}}' 2>/dev/null | grep -qx 'edge'; then
    die "a Docker network named 'edge' exists (School Kit's shared network on the VPS). Run on an isolated machine."
  fi
fi
if listening_on "${BGF_TEST_PROD_PORT:-5433}"; then
  die "something listens on port ${BGF_TEST_PROD_PORT:-5433}, the VPS Postgres host port. Run on an isolated machine."
fi
echo "   no production markers, containers, networks or listeners; client environment cleared"

# ── dump ───────────────────────────────────────────────────────────────────
step dump "verify the dump"
[ -f "$DUMP" ] || die "dump file not found: $DUMP"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PG_BIN/pg_restore" ] && [ -x "$PG_BIN/initdb" ] && [ -x "$PG_BIN/pg_ctl" ] && [ -x "$PG_BIN/psql" ] || die "Postgres server binaries not found (set PG_BIN)"
TOC=$("$PG_BIN/pg_restore" -l "$DUMP" 2>/dev/null) || die "pg_restore cannot read the dump (not a custom-format pg_dump, or corrupt)"
DUMP_PGDUMP_MAJOR=$(echo "$TOC" | sed -n 's/^;[[:space:]]*Dumped by pg_dump version: \([0-9]*\).*/\1/p')
DUMP_SERVER_MAJOR=$(echo "$TOC" | sed -n 's/^;[[:space:]]*Dumped from database version: \([0-9]*\).*/\1/p')
LOCAL_MAJOR=$("$PG_BIN/pg_restore" --version | sed 's/[^0-9]*\([0-9]*\).*/\1/')
[ -n "$DUMP_PGDUMP_MAJOR" ] && [ -n "$LOCAL_MAJOR" ] || die "cannot determine pg_dump / local Postgres versions"
[ "$LOCAL_MAJOR" -ge "$DUMP_PGDUMP_MAJOR" ] || die "dump written by pg_dump $DUMP_PGDUMP_MAJOR; local Postgres is $LOCAL_MAJOR. Install Postgres $DUMP_PGDUMP_MAJOR server binaries and set PG_BIN."
[ "$LOCAL_MAJOR" -ge "${DUMP_SERVER_MAJOR:-0}" ] || die "dump is from server $DUMP_SERVER_MAJOR; local Postgres is $LOCAL_MAJOR. Install Postgres $DUMP_SERVER_MAJOR server binaries and set PG_BIN."
echo "$TOC" | grep -qE '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA public Prediction ' || die "dump has no TABLE DATA for public.\"Prediction\""
echo "$TOC" | grep -qE '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA public AIJob ' || die "dump has no TABLE DATA for public.\"AIJob\""
ARCHIVE_CREATED=$(echo "$TOC" | sed -n 's/^; Archive created at \(.*\)$/\1/p')
DUMP_SHA=$(sha256sum "$DUMP" | cut -d' ' -f1)
DUMP_BYTES=$(wc -c < "$DUMP")
if [ -z "$AS_OF" ]; then
  AS_OF=$(date -u -d "$ARCHIVE_CREATED" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null) || die "cannot parse the dump's creation time; pass --as-of"
fi
echo "   sha256 $DUMP_SHA, $DUMP_BYTES bytes, created $ARCHIVE_CREATED"
echo "   pg_dump $DUMP_PGDUMP_MAJOR / server $DUMP_SERVER_MAJOR; local $LOCAL_MAJOR; as_of $AS_OF"

mkdir -p "$(dirname "$OUT")"
mkdir "$OUT" 2>/dev/null || die "could not create $OUT (it may have appeared concurrently)"
OUT_CREATED=1

# ── cluster ────────────────────────────────────────────────────────────────
step cluster "throwaway socket-only cluster"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/bgf-research.XXXXXXXX")
chmod 700 "$WORK"
echo "   scratch: $WORK"
if [ "$(id -u)" = "0" ]; then
  id -u pgresearch >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin pgresearch
  chown pgresearch "$WORK"; RUN=(runuser -u pgresearch --)
fi
SOCK="$WORK/sock"; PORT=5432   # the port only names the socket file inside the private directory
"${RUN[@]}" mkdir -m 700 "$SOCK"
SU_PW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
RO_PW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
( umask 077; printf '%s\n' "$SU_PW" > "$WORK/supw" )
[ ${#RUN[@]} -eq 0 ] || chown pgresearch "$WORK/supw"
"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U research_admin --auth=scram-sha-256 --pwfile="$WORK/supw" >/dev/null
rm -f "$WORK/supw"
CLUSTER_STARTED=1
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -l "$WORK/pg.log" -w start \
  -o "-c listen_addresses='' -c unix_socket_directories='$SOCK' -c port=$PORT -c shared_buffers=128MB -c max_connections=10" >/dev/null
( umask 077; printf '*:*:*:research_admin:%s\n' "$SU_PW" > "$WORK/pgpass" )
export PGPASSFILE="$WORK/pgpass"
PSQL=("$PG_BIN/psql" -h "$SOCK" -p "$PORT" -U research_admin -v ON_ERROR_STOP=1 -qAt)
"${PSQL[@]}" -d postgres -c "CREATE DATABASE research" 2>"$WORK/psql.err" || die "could not create the scratch database: $(summarise_err "$WORK/psql.err")"
DATADIR=$("${PSQL[@]}" -d research -c "SHOW data_directory")
SERVER_ADDR=$("${PSQL[@]}" -d research -c "SELECT coalesce(inet_server_addr()::text, 'unix-socket')")
[ "$(realpath "$DATADIR")" = "$(realpath "$WORK/data")" ] || die "connected to an unexpected server (data directory mismatch)"
[ "$SERVER_ADDR" = "unix-socket" ] || die "connected over TCP; expected the private socket only"
echo "   own data directory verified; unix socket only, no TCP listener"

# ── restore ────────────────────────────────────────────────────────────────
step restore "Prediction and AIJob only"
R0=$(date +%s)
inject restore
# Unquoted names: pg_restore matches -t literally, so '"Prediction"' would match nothing (and exit 0).
"$PG_BIN/pg_restore" --no-owner --no-privileges --exit-on-error -t Prediction -t AIJob \
  -h "$SOCK" -p "$PORT" -U research_admin -d research "$DUMP" 2>"$WORK/restore.err" \
  || die "pg_restore failed: $(summarise_err "$WORK/restore.err")"
TABLES=$("${PSQL[@]}" -d research -c "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'")
[ "$TABLES" = "AIJob,Prediction" ] || die "unexpected tables after restore: $TABLES"
N_PRED=$("${PSQL[@]}" -d research -c 'SELECT count(*) FROM "Prediction"')
N_JOB=$("${PSQL[@]}" -d research -c 'SELECT count(*) FROM "AIJob"')
[ "$N_PRED" -gt 0 ] && [ "$N_JOB" -gt 0 ] || die "restored tables are empty (Prediction=$N_PRED, AIJob=$N_JOB)"
RESTORE_S=$(( $(date +%s) - R0 ))
echo "   Prediction $N_PRED rows, AIJob $N_JOB rows, ${RESTORE_S}s"

# ── minimise ───────────────────────────────────────────────────────────────
step minimise "drop columns the extractor never reads"
"${PSQL[@]}" -d research 2>"$WORK/psql.err" <<'SQL' || die "column minimisation failed: $(summarise_err "$WORK/psql.err")"
ALTER TABLE "AIJob" DROP COLUMN IF EXISTS prompt, DROP COLUMN IF EXISTS "rawOutput", DROP COLUMN IF EXISTS "reviewerNote";
ALTER TABLE "Prediction" DROP COLUMN IF EXISTS reasoning, DROP COLUMN IF EXISTS "matchPreview", DROP COLUMN IF EXISTS "analysisJson",
  DROP COLUMN IF EXISTS "previousDrafts", DROP COLUMN IF EXISTS "settlementNote";
SQL
echo "   prompts, raw model output, reasoning prose and draft history removed from the scratch copy"

# ── extract ────────────────────────────────────────────────────────────────
step extract "read-only role and extraction"
# The SQL (with the password) goes to psql on stdin, never argv; errors are captured privately.
"${PSQL[@]}" -d research 2>"$WORK/psql.err" <<SQL || die "role creation failed: $(summarise_err "$WORK/psql.err")"
CREATE ROLE betgenius_research LOGIN PASSWORD '$RO_PW';
GRANT CONNECT ON DATABASE research TO betgenius_research;
GRANT USAGE ON SCHEMA public TO betgenius_research;
GRANT SELECT ON "Prediction", "AIJob" TO betgenius_research;
ALTER ROLE betgenius_research SET default_transaction_read_only = on;
ALTER ROLE betgenius_research SET statement_timeout = '120s';
ALTER ROLE betgenius_research CONNECTION LIMIT 2;
SQL
inject extract
E0=$(date +%s)
RESEARCH_READONLY_DATABASE_URL="postgresql://betgenius_research:$RO_PW@localhost/research?host=$SOCK&port=$PORT" \
  node --max-old-space-size=384 --import tsx research/forecasting/extract/extract.ts \
  --out "$OUT/dataset" --as-of "$AS_OF" --page-size 50 2>&1 | scrub | tee "$OUT/extract.log"
EXTRACT_S=$(( $(date +%s) - E0 ))
unset RO_PW SU_PW PGPASSFILE

# ── teardown ───────────────────────────────────────────────────────────────
step teardown "the dataset exists; destroy the scratch database now"
teardown_cluster

# ── validate ───────────────────────────────────────────────────────────────
step validate "dataset integrity (--require-real)"
inject validate
( cd research/forecasting && "$PY" -m bgforecast validate --dataset "$OUT/dataset" --require-real ) 2>&1 | scrub | tee "$OUT/validation.log"
TRAIN_S=0
if [ "$EXTRACT_ONLY" = "0" ]; then
  step evaluate "pre-registered evaluation (nice 19, $THREADS threads)"
  inject evaluate
  T1=$(date +%s)
  EXTRA=(); [ "$QUICK" = "1" ] && EXTRA=(--quick)
  ( cd research/forecasting && nice -n 19 "$PY" -m bgforecast run --dataset "$OUT/dataset" --out "$OUT/run" \
      --sensitivity --threads "$THREADS" --require-real "${EXTRA[@]}" ) 2>&1 | scrub | tee "$OUT/run.log"
  TRAIN_S=$(( $(date +%s) - T1 ))
fi

STAGE="provenance"
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
STAGE="done"
echo; echo "done: $OUT (report: $OUT/run/report.md). Production-derived data: keep private."
