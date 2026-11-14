#!/usr/bin/env bash
# End-to-end check of isolated-run.sh against a SYNTHETIC dump.
#
# Builds a full-schema source database seeded with fictional rows (plus a fake
# user e-mail and a marker prompt that must never survive into the research
# copy), pg_dumps it, destroys the source, then checks:
#   - every refusal (production markers, containers, networks, listener, dump
#     problems, version guard, output outside work/ or already existing);
#   - isolation: a DECOY Postgres on the old fixed TCP port, with a hostile PG*
#     environment pointing at it, receives no connection from any run;
#   - cleanup: injected failures at every stage, a natural restore failure
#     (truncated dump) and SIGTERM mid-run all leave no scratch directory, no
#     process and no incomplete outputs;
#   - a full successful run (outputs, provenance, validation, gates);
#   - no credential, connection string or canary in any log or output.
# Nothing outside temp directories and research/forecasting/work is touched.
#
# Run from the repository root:  BGF_PYTHON=<venv python> bash research/forecasting/restore/check-isolated-run.sh
set -euo pipefail

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PG_BIN
: "${BGF_PYTHON:?set BGF_PYTHON to the research venv python}"
export BGF_PYTHON
REAL_MAJOR=$("$PG_BIN/pg_restore" --version | sed 's/[^0-9]*\([0-9]*\).*/\1/')
echo "Postgres binaries: $PG_BIN (major $REAL_MAJOR); installed: $(ls /usr/lib/postgresql 2>/dev/null | tr '\n' ' ')"

T=$(mktemp -d); chmod 755 "$T"
WORKREL="research/forecasting/work"
TAG="check-isolated-$$"
SRC_PORT=55498; DECOY_PORT=55499
RUN=()
if [ "$(id -u)" = "0" ]; then
  id -u pgintegration >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin pgintegration
  chown pgintegration "$T"; RUN=(runuser -u pgintegration --)
fi
pg() { local b="$1"; shift; "${RUN[@]}" "$PG_BIN/$b" "$@"; }
cleanup() {
  for d in "$T/src" "$T/decoy"; do pg pg_ctl -D "$d" -m immediate stop >/dev/null 2>&1 || true; done
  rm -rf "$T" "$WORKREL/$TAG"*
}
trap cleanup EXIT
mkdir -p "$WORKREL"
BEFORE=$(ls -1 "$WORKREL" | sort)

failures=0
check() { # $1 label, $2 status (0 = pass), $3 optional log to show on failure
  if [ "$2" = "0" ]; then echo "  PASS  $1"; else
    echo "  FAIL  $1"; failures=$((failures + 1))
    if [ -n "${3:-}" ] && [ -f "$3" ]; then sed 's/^/        | /' "$3" | tail -8; fi
  fi
  return 0
}
ISO=research/forecasting/restore/isolated-run.sh
iso() { bash "$ISO" "$@"; }
scratch_of() { sed -n 's/^   scratch: //p' "$1" | head -1; }

echo "building a synthetic source database and dump…"
pg initdb -D "$T/src" -U admin --auth=trust >/dev/null
pg pg_ctl -D "$T/src" -o "-p $SRC_PORT -k $T -c listen_addresses=localhost" -l "$T/src.log" -w start >/dev/null
URL="postgresql://admin@localhost:$SRC_PORT/source"
"$PG_BIN/psql" -h localhost -p "$SRC_PORT" -U admin -d postgres -qc "CREATE DATABASE source"
DATABASE_URL="$URL" DATABASE_URL_UNPOOLED="$URL" npx prisma db push --skip-generate --accept-data-loss >/dev/null
BENCH_ADMIN_URL="$URL" BENCH_FIXTURES=500 BENCH_JOBS=560 BENCH_V1_JOBS=40 BENCH_V1_KB=20 BENCH_PREDICTIONS=900 \
  npx tsx research/forecasting/extract/integration/bench-seed.ts >/dev/null
"$PG_BIN/psql" -h localhost -p "$SRC_PORT" -U admin -d source -q <<'SQL'
INSERT INTO "User"(id, email, "updatedAt") VALUES ('canary-user', 'canary-user@example.invalid', now());
UPDATE "AIJob" SET prompt = 'CANARY-PROMPT-MUST-NOT-SURVIVE' WHERE id = 'benchjob000000';
SQL
"$PG_BIN/pg_dump" -h localhost -p "$SRC_PORT" -U admin -Fc -f "$T/source.dump" source
"$PG_BIN/pg_dump" -h localhost -p "$SRC_PORT" -U admin -Fc -T '"AIJob"' -f "$T/noaijob.dump" source
pg pg_ctl -D "$T/src" -m fast stop >/dev/null
DUMP_MAJOR=$("$PG_BIN/pg_restore" -l "$T/source.dump" | sed -n 's/^;[[:space:]]*Dumped by pg_dump version: \([0-9]*\).*/\1/p')
echo "source destroyed; dump written by pg_dump $DUMP_MAJOR"

# A decoy server on the OLD fixed port, logging every connection. Nothing in this check may ever reach it.
pg initdb -D "$T/decoy" -U admin --auth=trust >/dev/null
pg pg_ctl -D "$T/decoy" -o "-p $DECOY_PORT -k $T -c listen_addresses=localhost -c log_connections=on" -l "$T/decoy.log" -w start >/dev/null
# Everything below runs with a hostile client environment aimed at the decoy.
export PGHOST=localhost PGPORT=$DECOY_PORT PGUSER=admin PGDATABASE=postgres PGPASSWORD=decoy-password
DECOY_BASELINE=$(grep -c "connection authorized" "$T/decoy.log" || true)

set +e
echo "refusals (host):"
BGF_TEST_PROD_MARKERS="$T" iso --dump "$T/source.dump" --out "$WORKREL/$TAG-refusal-1" --extract-only > "$T/r1.log" 2>&1
grep -q "looks like the production VPS" "$T/r1.log"; check "deployment directory marker" $? "$T/r1.log"
printf '#!/bin/sh\n[ "$1" = ps ] && echo "betgenius-postgres-1 betgenius"\nexit 0\n' > "$T/docker-ps"; chmod +x "$T/docker-ps"
BGF_TEST_DOCKER="$T/docker-ps" iso --dump "$T/source.dump" --out "$WORKREL/$TAG-refusal-2" --extract-only > "$T/r2.log" 2>&1
grep -q "School Kit containers are running" "$T/r2.log"; check "BetGenius/School Kit container or compose project" $? "$T/r2.log"
printf '#!/bin/sh\n[ "$1" = network ] && printf "bridge\\nedge\\nhost\\n"\nexit 0\n' > "$T/docker-net"; chmod +x "$T/docker-net"
BGF_TEST_DOCKER="$T/docker-net" iso --dump "$T/source.dump" --out "$WORKREL/$TAG-refusal-3" --extract-only > "$T/r3.log" 2>&1
grep -q "network named 'edge'" "$T/r3.log"; check "School Kit 'edge' network" $? "$T/r3.log"
BGF_TEST_PROD_PORT=$DECOY_PORT iso --dump "$T/source.dump" --out "$WORKREL/$TAG-refusal-4" --extract-only > "$T/r4.log" 2>&1
grep -q "listens on port $DECOY_PORT" "$T/r4.log"; check "listener on the VPS Postgres port (simulated by the decoy)" $? "$T/r4.log"

echo "refusals (inputs):"
iso --dump "$T/noaijob.dump" --out "$WORKREL/$TAG-refusal-5" --extract-only > "$T/r5.log" 2>&1
grep -q 'no TABLE DATA for public."AIJob"' "$T/r5.log"; check "dump without AIJob data" $? "$T/r5.log"
printf 'not a dump' > "$T/garbage.dump"
iso --dump "$T/garbage.dump" --out "$WORKREL/$TAG-refusal-6" --extract-only > "$T/r6.log" 2>&1
grep -q "cannot read the dump" "$T/r6.log"; check "unreadable dump" $? "$T/r6.log"
iso --dump "$T/source.dump" --out /tmp/outside-work --extract-only > "$T/r7.log" 2>&1
grep -q "must be inside research/forecasting/work" "$T/r7.log"; check "output outside the gitignored work tree" $? "$T/r7.log"
mkdir -p "$WORKREL/$TAG-existing"; echo keep > "$WORKREL/$TAG-existing/sentinel"
iso --dump "$T/source.dump" --out "$WORKREL/$TAG-existing" --extract-only > "$T/r8.log" 2>&1
grep -q "already exists" "$T/r8.log" && [ "$(cat "$WORKREL/$TAG-existing/sentinel")" = keep ] && [ "$(ls "$WORKREL/$TAG-existing")" = sentinel ]
check "existing output directory refused and left untouched" $? "$T/r8.log"

# Version guard. The shim's pg_restore reports one major BELOW the dump's pg_dump,
# derived from the real binaries, so the expectation holds on any runner. (The first
# version hard-coded "15" and expected "Install Postgres 16": it only passed where
# the newest local Postgres was 16.)
SHIM="$T/shim"; mkdir -p "$SHIM"
for b in "$PG_BIN"/*; do ln -s "$b" "$SHIM/$(basename "$b")"; done
rm "$SHIM/pg_restore"
OLDER=$((DUMP_MAJOR - 1))
printf '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "pg_restore (PostgreSQL) %s.0"; exit 0; fi\nexec "%s/pg_restore" "$@"\n' "$OLDER" "$PG_BIN" > "$SHIM/pg_restore"
chmod +x "$SHIM/pg_restore"
PG_BIN="$SHIM" iso --dump "$T/source.dump" --out "$WORKREL/$TAG-refusal-7" --extract-only > "$T/r9.log" 2>&1
grep -q "dump written by pg_dump $DUMP_MAJOR; local Postgres is $OLDER. Install Postgres $DUMP_MAJOR server binaries" "$T/r9.log"
check "version guard: a pg_dump $DUMP_MAJOR dump is refused by a Postgres $OLDER pg_restore" $? "$T/r9.log"
! grep -q "TEST HOOK ACTIVE" "$T/r9.log"; check "version guard exercised without any test hook" $? "$T/r9.log"

echo "cleanup on failure:"
assert_clean() { # $1 label, $2 log, $3 out dir, $4 expected stage
  local s; s=$(scratch_of "$2")
  grep -q "FAILED at stage: $4" "$2" && [ -n "$s" ] && [ ! -e "$s" ] && ! pgrep -f -- "$s/data" >/dev/null && [ ! -e "$3" ]
  check "$1: failed at '$4', scratch cluster gone, no process, no outputs" $? "$2"
}
for stage in restore extract validate evaluate; do
  BGF_TEST_FAIL_AT=$stage iso --dump "$T/source.dump" --out "$WORKREL/$TAG-fail-$stage" --quick > "$T/f-$stage.log" 2>&1
  assert_clean "injected failure" "$T/f-$stage.log" "$WORKREL/$TAG-fail-$stage" "$stage"
done
SZ=$(wc -c < "$T/source.dump"); head -c $((SZ * 2 / 3)) "$T/source.dump" > "$T/truncated.dump"
iso --dump "$T/truncated.dump" --out "$WORKREL/$TAG-truncated" --extract-only > "$T/f-trunc.log" 2>&1
assert_clean "truncated dump (natural restore failure)" "$T/f-trunc.log" "$WORKREL/$TAG-truncated" "restore"
BGF_TEST_FAIL_AT=validate iso --dump "$T/source.dump" --out "$WORKREL/$TAG-keep" --keep-failed-outputs > "$T/f-keep.log" 2>&1
KS=$(scratch_of "$T/f-keep.log")
[ -f "$WORKREL/$TAG-keep/dataset/manifest.json" ] && [ -n "$KS" ] && [ ! -e "$KS" ]
check "--keep-failed-outputs keeps outputs but still destroys the cluster" $? "$T/f-keep.log"
rm -rf "$WORKREL/$TAG-keep"
# Invoked directly (not through the iso function) so that $! is the runner's own PID.
BGF_TEST_PAUSE_AT=extract bash "$ISO" --dump "$T/source.dump" --out "$WORKREL/$TAG-term" --extract-only > "$T/f-term.log" 2>&1 &
ISO_PID=$!
for _ in $(seq 1 120); do grep -q "paused at extract" "$T/f-term.log" && break; sleep 0.5; done
kill -TERM "$ISO_PID"; wait "$ISO_PID"; TERM_RC=$?
[ "$TERM_RC" = "143" ]; check "SIGTERM mid-run exits 143" $? "$T/f-term.log"
assert_clean "SIGTERM mid-run" "$T/f-term.log" "$WORKREL/$TAG-term" "extract"
set -e

echo "isolated run on the synthetic dump (hostile PG* environment aimed at the decoy):"
OUT="$WORKREL/$TAG-ok"
iso --dump "$T/source.dump" --out "$OUT" --quick > "$T/run.log" 2>&1 || { tail -30 "$T/run.log"; exit 1; }
set +e
grep -q "Prediction 900 rows, AIJob 560 rows" "$T/run.log"; check "only Prediction and AIJob restored, with all rows" $? "$T/run.log"
grep -q "own data directory verified; unix socket only" "$T/run.log"; check "connected only to its own socket-only cluster" $? "$T/run.log"
S=$(scratch_of "$T/run.log"); [ -n "$S" ] && [ ! -e "$S" ] && ! pgrep -f -- "$S/data" >/dev/null
check "scratch cluster destroyed after extraction" $? "$T/run.log"
[ "$(grep -c "connection authorized" "$T/decoy.log" || true)" = "$DECOY_BASELINE" ]
check "decoy server on the old fixed port received no connection from any run" $? "$T/decoy.log"
python3 - "$OUT" <<'PYCHECK'
import json, sys, pathlib
out = pathlib.Path(sys.argv[1])
m = json.loads((out / "dataset/manifest.json").read_text())
r = json.loads((out / "run/results.json").read_text())
p = json.loads((out / "run-provenance.json").read_text())
ok = lambda name, cond: print(f"  {'PASS' if cond else 'FAIL'}  {name}") or (0 if cond else 1)
f = 0
f += ok("dataset came from a verified read-only snapshot", m["source"] == "postgres" and m["database"]["read_only_verified"] is True)
f += ok("as_of is the dump's creation time", m["as_of"].startswith(p["as_of"][:16]))
f += ok("dataset validated before training", r["validation"]["valid"] is True)
f += ok("evaluation ran with all eight gates", r["status"] == "evaluated" and len(r["recommendation"]["gates"]) == 8)
f += ok("boundary and ledger-mode sensitivity reported", "boundary_sensitivity" in r and "sensitivity" in r)
f += ok("provenance records dump hash and row counts", len(p["dump"]["sha256"]) == 64 and p["restored_rows"] == {"Prediction": 900, "AIJob": 560})
f += ok("research ran at the requested thread count", r["resources"]["xgboost_nthread"] == 2)
sys.exit(f)
PYCHECK
check "outputs" $?
# Secrets and sensitive data: no password-shaped token (the runner's 48-hex passwords), no
# connection string, no decoy password and no canary anywhere in any log or output.
LEAKS="$T/leaks.txt"
{ cat "$T"/*.log; find "$OUT" -type f -exec cat {} +; } > "$LEAKS" 2>/dev/null
! grep -qE '\b[0-9a-f]{48}\b' "$LEAKS"; check "no generated password in any log or output" $?
! grep -qE 'postgres(ql)?://' "$LEAKS"; check "no connection string in any log or output" $?
! grep -q 'decoy-password' "$LEAKS"; check "inherited PGPASSWORD never echoed" $?
! grep -q 'canary-user@example.invalid' "$LEAKS"; check "canary user e-mail never reached any log or output" $?
! grep -q 'CANARY-PROMPT-MUST-NOT-SURVIVE' "$LEAKS"; check "canary prompt never reached any log or output" $?
set -e

STRAY=$(comm -13 <(echo "$BEFORE") <(ls -1 "$WORKREL" | sort) | grep -vxE "$TAG-(ok|existing)" || true)
[ -z "$STRAY" ]; check "no refusal or failure left anything in the work tree" $?
[ "$failures" = "0" ] && echo "all isolated-run checks passed" || { echo "$failures isolated-run check(s) FAILED"; exit 1; }
