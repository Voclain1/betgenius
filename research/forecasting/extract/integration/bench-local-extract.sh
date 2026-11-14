#!/usr/bin/env bash
# Measure extractor cost at production-like volume against a THROWAWAY local
# Postgres configured like the VPS container (shared_buffers 192 MB,
# effective_cache_size 512 MB). Synthetic rows only; nothing outside a temp
# directory is touched and the cluster is deleted on exit.
#
# Reports, per extractor setting: wall time, how long the read-only snapshot
# was held, extractor peak RSS, and peak total RSS of the Postgres processes.
#
# Run from the repository root:  bash research/forecasting/extract/integration/bench-local-extract.sh
set -euo pipefail

PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
WORK="$(mktemp -d)"
PORT="${BENCH_PG_PORT:-55433}"
PW="bench-pw"
RUN=()
PG_OS_USER="$(id -un)"
if [ "$(id -u)" = "0" ]; then
  PG_OS_USER=pgintegration
  id -u pgintegration >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin pgintegration
  chown -R pgintegration "$WORK"
  RUN=(runuser -u pgintegration --)
fi
cleanup() { "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U admin --auth=trust >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=localhost -c shared_buffers=192MB -c effective_cache_size=512MB" \
  -l "$WORK/pg.log" -w start >/dev/null
ADMIN_URL="postgresql://admin@localhost:$PORT/bench"
"$PG_BIN/psql" -h localhost -p "$PORT" -U admin -d postgres -qc "CREATE DATABASE bench" >/dev/null
DATABASE_URL="$ADMIN_URL" DATABASE_URL_UNPOOLED="$ADMIN_URL" npx prisma db push --skip-generate --accept-data-loss >/dev/null
BENCH_ADMIN_URL="$ADMIN_URL" npx tsx research/forecasting/extract/integration/bench-seed.ts
"$PG_BIN/psql" -h localhost -p "$PORT" -U admin -d bench -q <<SQL
CREATE ROLE research_ro LOGIN PASSWORD '$PW';
GRANT CONNECT ON DATABASE bench TO research_ro;
GRANT USAGE ON SCHEMA public TO research_ro;
GRANT SELECT ON "Prediction", "AIJob" TO research_ro;
ALTER ROLE research_ro SET default_transaction_read_only = on;
SQL
RO_URL="postgresql://research_ro:$PW@localhost:$PORT/bench"

pg_rss_mib() { ps -u "$PG_OS_USER" -o rss=,comm= 2>/dev/null | awk '$2 ~ /postgres/ {s+=$1} END {printf "%d", s/1024}'; }

# Each variant: "<max-old-space-size MiB or 0>|<extractor flags>"
VARIANTS=("0|--page-size 200" "0|--page-size 50" "384|--page-size 50" "256|--page-size 25 --page-delay-ms 100")
for variant in "${VARIANTS[@]}"; do
  heap="${variant%%|*}"; setting="${variant#*|}"
  node_flags=(); [ "$heap" != "0" ] && node_flags=(--max-old-space-size="$heap")
  ( while true; do v=$(pg_rss_mib); echo "$v"; sleep 0.2; done ) > "$WORK/pgrss.log" &
  sampler=$!
  start=$(date +%s.%N)
  # shellcheck disable=SC2086
  RESEARCH_READONLY_DATABASE_URL="$RO_URL" node "${node_flags[@]}" --import tsx research/forecasting/extract/extract.ts --out "$WORK/out" $setting | grep -E "snapshot held|fixtures:"
  end=$(date +%s.%N)
  kill "$sampler" 2>/dev/null || true
  peak=$(sort -n "$WORK/pgrss.log" | tail -1)
  printf '  heap cap %s MiB, setting [%s]: wall %.1fs, postgres processes peak RSS %s MiB\n' "$heap" "$setting" "$(awk -v a="$start" -v b="$end" 'BEGIN {print b - a}')" "$peak"
done
