#!/usr/bin/env bash
# Spin up a THROWAWAY Postgres cluster in a temp directory, push the BetGenius
# schema into it, create a read-only research role and a read-write role, seed
# synthetic rows and run the real extractor against it. Nothing outside the temp
# directory is touched; the cluster is stopped and deleted on exit.
#
# Requires: postgres server binaries (initdb, pg_ctl) and npm dependencies.
# Run from the repository root:  bash research/forecasting/extract/integration/run-local-integration.sh
set -euo pipefail

PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
WORK="$(mktemp -d)"
PORT="${INTEGRATION_PG_PORT:-55432}"
PW="integration-pw"

# initdb and pg_ctl refuse to run as root; use an unprivileged user when we are root.
RUN=()
if [ "$(id -u)" = "0" ]; then
  id -u pgintegration >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin pgintegration
  chown -R pgintegration "$WORK"
  RUN=(runuser -u pgintegration --)
fi
cleanup() { "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U admin --auth=trust >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=localhost" -l "$WORK/pg.log" -w start >/dev/null

ADMIN_URL="postgresql://admin@localhost:$PORT/betgenius_integration"
"$PG_BIN/psql" -h localhost -p "$PORT" -U admin -d postgres -qc "CREATE DATABASE betgenius_integration" >/dev/null

DATABASE_URL="$ADMIN_URL" DATABASE_URL_UNPOOLED="$ADMIN_URL" npx prisma db push --skip-generate --accept-data-loss >/dev/null

"$PG_BIN/psql" -h localhost -p "$PORT" -U admin -d betgenius_integration -q <<SQL
-- The documented research role (docs/research/XGBOOST_RESEARCH_ENGINE.md).
CREATE ROLE research_ro LOGIN PASSWORD '$PW';
GRANT CONNECT ON DATABASE betgenius_integration TO research_ro;
GRANT USAGE ON SCHEMA public TO research_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO research_ro;
ALTER ROLE research_ro SET default_transaction_read_only = on;
ALTER ROLE research_ro SET statement_timeout = '120s';
-- A role that must be refused: read-only by default, but holding write grants.
CREATE ROLE research_rw LOGIN PASSWORD '$PW';
GRANT USAGE ON SCHEMA public TO research_rw;
GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA public TO research_rw;
ALTER ROLE research_rw SET default_transaction_read_only = on;
SQL

INTEGRATION_ADMIN_URL="$ADMIN_URL" \
INTEGRATION_RO_URL="postgresql://research_ro:$PW@localhost:$PORT/betgenius_integration" \
INTEGRATION_RW_URL="postgresql://research_rw:$PW@localhost:$PORT/betgenius_integration" \
INTEGRATION_OUT="$WORK/out" \
  npx tsx research/forecasting/extract/integration/check-integration.ts
