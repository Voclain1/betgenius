#!/bin/sh
# Calls a scheduled route the way Vercel Cron did: GET with the CRON_SECRET
# bearer. Straight to the app on the internal network, not through the
# internet, so Cloudflare and Caddy are not in the path.
set -eu
. /ops/env.sh
path="$1"
echo "$(date -u +%FT%TZ) cron $path"
curl -fsS -m 330 -o /dev/null -w "  -> %{http_code} in %{time_total}s\n" \
  -H "Authorization: Bearer ${CRON_SECRET}" "http://app:3000${path}"
