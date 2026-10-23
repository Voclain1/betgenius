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

# HTTPS comes from School Kit's Caddy on the same server (/opt/school-kit),
# which must be deployed first: it creates the `edge` network this stack joins.
SCHOOL_KIT=/opt/school-kit
if ! docker network inspect edge >/dev/null 2>&1 || [ ! -f "$SCHOOL_KIT/lib.sh" ]; then
  echo "::error::School Kit is not deployed on this server yet (no edge network or $SCHOOL_KIT/lib.sh). Run naija-class's deploy-vps first."
  exit 1
fi
SITE_DOMAIN=$(grep '^SITE_DOMAIN=' deploy.env | cut -d= -f2)

PREV_TAG=$(grep '^APP_TAG=' deploy.env 2>/dev/null | cut -d= -f2 || true)
sed -i '/^APP_TAG=/d' deploy.env
echo "APP_TAG=$NEW_TAG" >> deploy.env

compose pull app
compose up -d --build --remove-orphans

for i in $(seq 1 40); do
  if curl -fsS -m 5 -o /dev/null http://127.0.0.1:3000/api/health; then
    echo "healthy on $NEW_TAG (was ${PREV_TAG:-none})"
    # Point School Kit's Caddy at this app (www. redirects to the bare domain).
    cat > "$SCHOOL_KIT/sites/betgenius.caddy" <<CADDY
$SITE_DOMAIN {
	encode zstd gzip
	reverse_proxy betgenius-app:3000 {
		header_up X-Real-IP {client_ip}
		header_up X-Forwarded-For {client_ip}
	}
}

www.$SITE_DOMAIN {
	redir https://$SITE_DOMAIN{uri} permanent
}
CADDY
    (cd "$SCHOOL_KIT" && . ./lib.sh && reload_caddy)
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
