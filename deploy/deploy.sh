#!/bin/bash
# Switches the running app to a new image tag, with automatic rollback.
# Run on the server by deploy-vps.yml:  ./deploy.sh <tag>
#
# The previous tag is kept in deploy.env until the new one answers
# /api/health with 200; if it never does within ~2 minutes, the old image is
# started again and the deploy fails. Manual rollback: ./deploy.sh <old tag>
# (`docker image ls` lists the tags still on the server).
set -euo pipefail
cd "$(dirname "$0")"
NEW_TAG="${1:?usage: deploy.sh <image tag>}"
compose() { docker compose --env-file deploy.env "$@"; }

PREV_TAG=$(grep '^APP_TAG=' deploy.env 2>/dev/null | cut -d= -f2 || true)
sed -i '/^APP_TAG=/d' deploy.env
echo "APP_TAG=$NEW_TAG" >> deploy.env

compose pull app
compose up -d --build --remove-orphans

for i in $(seq 1 40); do
  if curl -fsS -m 5 -o /dev/null http://127.0.0.1:3000/api/health; then
    echo "healthy on $NEW_TAG (was ${PREV_TAG:-none})"
    docker image prune -af --filter "until=336h" >/dev/null || true
    exit 0
  fi
  sleep 3
done

echo "::error::$NEW_TAG did not become healthy"
compose logs --tail 80 app || true
if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$NEW_TAG" ]; then
  echo "rolling back to $PREV_TAG"
  sed -i '/^APP_TAG=/d' deploy.env
  echo "APP_TAG=$PREV_TAG" >> deploy.env
  compose up -d app
fi
exit 1
