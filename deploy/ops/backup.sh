#!/bin/sh
# Nightly pg_dump to off-server object storage (an rclone remote named
# "backup", configured by the RCLONE_CONFIG_BACKUP_* settings in ops.env).
# Keeps 14 daily copies and 8 Sunday copies. Optional HEALTHCHECK_PING_URL is
# pinged on success, so a backup that silently stops running is noticed.
set -eu
. /ops/env.sh
stamp=$(date -u +%Y-%m-%dT%H%MZ)
file="/tmp/betgenius-${stamp}.dump"
trap 'rm -f "$file"' EXIT

pg_dump -Fc -f "$file"
size=$(wc -c < "$file")
[ "$size" -gt 1024 ] || { echo "dump is only ${size} bytes; refusing to upload"; exit 1; }

rclone copyto "$file" "backup:${BACKUP_BUCKET}/daily/$(basename "$file")"
if [ "$(date -u +%u)" = "7" ]; then
  rclone copyto "$file" "backup:${BACKUP_BUCKET}/weekly/$(basename "$file")"
fi
prune() { # $1 = folder, $2 = max age; a folder not created yet is not an error
  if rclone lsf "backup:${BACKUP_BUCKET}/$1" >/dev/null 2>&1; then
    rclone delete --min-age "$2" "backup:${BACKUP_BUCKET}/$1"
  fi
}
prune daily 15d
prune weekly 57d

echo "$(date -u +%FT%TZ) backup ok: $(basename "$file"), ${size} bytes"
[ -z "${HEALTHCHECK_PING_URL:-}" ] || curl -fsS -m 10 -o /dev/null "$HEALTHCHECK_PING_URL" || true
