# shellcheck shell=bash
# TEST-ONLY helper: build a SYNTHETIC full-schema BetGenius dump.
#
#   bgf_build_synthetic_dump <workdir> <port> <out.dump> [<out-noaijob.dump>]
#
# Creates a throwaway cluster under <workdir>/src with the binaries in
# DUMP_PG_BIN (default PG_BIN), pushes the real Prisma schema, seeds fictional
# rows (500 fixtures, 560 jobs, 900 predictions), plants a canary user e-mail
# and a canary prompt that must never reach any research output, dumps it, and
# destroys the cluster. Requires RUN (array, possibly empty) and PG_BIN set by
# the caller. Never point this at anything but its own temporary cluster.

bgf_build_synthetic_dump() {
  local work="$1" port="$2" out="$3" out_noaijob="${4:-}" bin="${DUMP_PG_BIN:-$PG_BIN}" url
  "${RUN[@]}" "$bin/initdb" -D "$work/src" -U admin --auth=trust >/dev/null
  "${RUN[@]}" "$bin/pg_ctl" -D "$work/src" -o "-p $port -k $work -c listen_addresses=localhost" -l "$work/src.log" -w start >/dev/null
  url="postgresql://admin@localhost:$port/source"
  "$bin/psql" -h localhost -p "$port" -U admin -d postgres -qc "CREATE DATABASE source"
  DATABASE_URL="$url" DATABASE_URL_UNPOOLED="$url" npx prisma db push --skip-generate --accept-data-loss >/dev/null
  BENCH_ADMIN_URL="$url" BENCH_FIXTURES=500 BENCH_JOBS=560 BENCH_V1_JOBS=40 BENCH_V1_KB=20 BENCH_PREDICTIONS=900 \
    npx tsx research/forecasting/extract/integration/bench-seed.ts >/dev/null
  "$bin/psql" -h localhost -p "$port" -U admin -d source -q <<'SQL'
INSERT INTO "User"(id, email, "updatedAt") VALUES ('canary-user', 'canary-user@example.invalid', now());
UPDATE "AIJob" SET prompt = 'CANARY-PROMPT-MUST-NOT-SURVIVE' WHERE id = 'benchjob000000';
SQL
  "$bin/pg_dump" -h localhost -p "$port" -U admin -Fc -f "$out" source
  if [ -n "$out_noaijob" ]; then
    "$bin/pg_dump" -h localhost -p "$port" -U admin -Fc -T '"AIJob"' -f "$out_noaijob" source
  fi
  "${RUN[@]}" "$bin/pg_ctl" -D "$work/src" -m fast stop >/dev/null
}
