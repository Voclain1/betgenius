#!/usr/bin/env bash
# End-to-end check of isolated-run.sh against a SYNTHETIC dump.
#
# Builds a full-schema source database seeded with fictional rows (plus a fake
# user e-mail and a marker prompt that must never survive into the research
# copy), pg_dumps it, destroys the source, then runs the isolated pipeline on
# the dump and checks the outputs and every refusal path. Nothing outside temp
# directories and research/forecasting/work is touched; all of it is removed.
#
# Run from the repository root:  bash research/forecasting/restore/check-isolated-run.sh
set -euo pipefail

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PG_BIN
PY="${BGF_PYTHON:?set BGF_PYTHON to the research venv python}"
SRC=$(mktemp -d); chmod 755 "$SRC"
OUT_REL="research/forecasting/work/check-isolated-$$"
PORT=55498
RUN=()
if [ "$(id -u)" = "0" ]; then
  id -u pgintegration >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin pgintegration
  chown pgintegration "$SRC"; RUN=(runuser -u pgintegration --)
fi
cleanup() { "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$SRC/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$SRC" "$OUT_REL" "$SRC.notables.dump"; }
trap cleanup EXIT

failures=0
check() { if [ "$2" = "0" ]; then echo "  PASS  $1"; else echo "  FAIL  $1"; failures=$((failures + 1)); fi; }

echo "building a synthetic source database and dump…"
"${RUN[@]}" "$PG_BIN/initdb" -D "$SRC/data" -U admin --auth=trust >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$SRC/data" -o "-p $PORT -k $SRC -c listen_addresses=localhost" -l "$SRC/pg.log" -w start >/dev/null
URL="postgresql://admin@localhost:$PORT/source"
"$PG_BIN/psql" -h localhost -p "$PORT" -U admin -d postgres -qc "CREATE DATABASE source"
DATABASE_URL="$URL" DATABASE_URL_UNPOOLED="$URL" npx prisma db push --skip-generate --accept-data-loss >/dev/null
BENCH_ADMIN_URL="$URL" BENCH_FIXTURES=500 BENCH_JOBS=560 BENCH_V1_JOBS=40 BENCH_V1_KB=20 BENCH_PREDICTIONS=900 \
  npx tsx research/forecasting/extract/integration/bench-seed.ts >/dev/null
"$PG_BIN/psql" -h localhost -p "$PORT" -U admin -d source -q <<'SQL'
INSERT INTO "User"(id, email, "updatedAt") VALUES ('canary-user', 'canary-user@example.invalid', now());
UPDATE "AIJob" SET prompt = 'CANARY-PROMPT-MUST-NOT-SURVIVE' WHERE id = 'benchjob000000';
SQL
"$PG_BIN/pg_dump" -h localhost -p "$PORT" -U admin -Fc -f "$SRC/source.dump" source
"$PG_BIN/pg_dump" -h localhost -p "$PORT" -U admin -Fc -T '"AIJob"' -f "$SRC.notables.dump" source
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$SRC/data" -m fast stop >/dev/null
echo "source database destroyed; only the dump remains"

echo "refusals:"
set +e
PROD_MARKERS="$SRC" bash research/forecasting/restore/isolated-run.sh --dump "$SRC/source.dump" --extract-only > "$SRC/r1.log" 2>&1
grep -q "looks like the production VPS" "$SRC/r1.log"; check "refuses to run on a host that looks like the production VPS" $?
bash research/forecasting/restore/isolated-run.sh --dump "$SRC.notables.dump" --extract-only > "$SRC/r2.log" 2>&1
grep -q 'no TABLE DATA for public."AIJob"' "$SRC/r2.log"; check "refuses a dump without AIJob data" $?
bash research/forecasting/restore/isolated-run.sh --dump "$SRC/source.dump" --out /tmp/outside-work --extract-only > "$SRC/r3.log" 2>&1
grep -q "must be inside research/forecasting/work" "$SRC/r3.log"; check "refuses an output directory outside the gitignored work tree" $?
printf 'not a dump' > "$SRC/garbage.dump"
bash research/forecasting/restore/isolated-run.sh --dump "$SRC/garbage.dump" --extract-only > "$SRC/r4.log" 2>&1
grep -q "cannot read the dump" "$SRC/r4.log"; check "refuses an unreadable dump" $?
# A pg_restore older than the dump's pg_dump must be refused, not half-restore.
# (Production runs Postgres 17; this sandbox only has 16, so the guard is tested
# with a shim that reports an older major version and passes everything else through.)
SHIM="$SRC/shim"; mkdir -p "$SHIM"
for b in "$PG_BIN"/*; do ln -s "$b" "$SHIM/$(basename "$b")"; done
rm "$SHIM/pg_restore"
printf '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "pg_restore (PostgreSQL) 15.0"; exit 0; fi\nexec "%s/pg_restore" "$@"\n' "$PG_BIN" > "$SHIM/pg_restore"
chmod +x "$SHIM/pg_restore"
PG_BIN="$SHIM" bash research/forecasting/restore/isolated-run.sh --dump "$SRC/source.dump" --extract-only > "$SRC/r5.log" 2>&1
grep -q "Install Postgres 16 server binaries" "$SRC/r5.log"; check "refuses a dump newer than the local Postgres (version guard)" $?
set -e

echo "isolated run on the synthetic dump:"
BGF_PYTHON="$PY" bash research/forecasting/restore/isolated-run.sh --dump "$SRC/source.dump" --out "$OUT_REL" --quick > "$SRC/run.log" 2>&1 || { tail -30 "$SRC/run.log"; exit 1; }
grep -q "Prediction 900 rows, AIJob 560 rows" "$SRC/run.log"; check "only Prediction and AIJob restored, with all rows" $?
grep -q "throwaway cluster destroyed" "$SRC/run.log"; check "scratch cluster destroyed after extraction" $?
set +e
python3 - "$OUT_REL" <<'PYCHECK'
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
blob = "".join(x.read_text(errors="ignore") for x in out.rglob("*") if x.is_file())
f += ok("canary user e-mail never reached any output", "canary-user@example.invalid" not in blob)
f += ok("canary prompt never reached any output", "CANARY-PROMPT-MUST-NOT-SURVIVE" not in blob)
sys.exit(f)
PYCHECK
rc=$?; set -e
check "outputs" $rc

[ "$failures" = "0" ] && echo "all isolated-run checks passed" || { echo "$failures isolated-run check(s) FAILED"; exit 1; }
