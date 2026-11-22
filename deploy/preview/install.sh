#!/usr/bin/env bash
# Deploys a password-protected, read-only BetGenius PR preview.
# One separate app, one separate Postgres volume. Production is never switched.
set -Eeuo pipefail
umask 077

PREVIEW_TAG="${1:?Provide image tag}"
case "$PREVIEW_TAG" in
  preview-[a-f0-9][a-f0-9]*) ;;
  *) echo "Invalid preview image tag" >&2; exit 2 ;;
esac

ROOT=/opt/betgenius/preview
SITE=/opt/school-kit/sites/betgenius-preview.caddy
cd "$ROOT"
test -s docker-compose.yml
test -s credential-public.pem
test -f /opt/betgenius/deploy.env
test -f /opt/school-kit/lib.sh

# Reuse an existing preview password across redeploys. These files never enter
# the public GitHub repository or GitHub Actions logs.
if [ ! -s .preview-db-password ]; then openssl rand -hex 24 > .preview-db-password; fi
if [ ! -s .preview-auth-password ]; then openssl rand -hex 18 > .preview-auth-password; fi
if [ ! -s .preview-nextauth-secret ]; then openssl rand -hex 32 > .preview-nextauth-secret; fi
DBPASS="$(cat .preview-db-password)"
PASSWORD="$(cat .preview-auth-password)"
AUTH_SECRET="$(cat .preview-nextauth-secret)"

# The staging server gets no production payment, provider, SMTP, analytics,
# auth or cron credentials. It is pointed solely at its own Postgres snapshot.
cat > .env <<ENVFILE
PREVIEW_DB_PASSWORD=$DBPASS
PREVIEW_IMAGE=ghcr.io/voclain1/betgenius
PREVIEW_TAG=$PREVIEW_TAG
ENVFILE
cat > app-preview.env <<ENVFILE
NODE_ENV=production
APP_ENV=preview
NEXTAUTH_URL=https://preview.betgenius.ng
NEXTAUTH_SECRET=$AUTH_SECRET
DATABASE_URL=postgresql://preview:$DBPASS@postgres:5432/preview?schema=public
DATABASE_URL_UNPOOLED=postgresql://preview:$DBPASS@postgres:5432/preview?schema=public
CRON_SECRET=preview-disabled
NEXT_PUBLIC_ADS_ORIGIN=
NEXT_PUBLIC_GA_ID=
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
ENVFILE

compose_preview() {
  docker compose --env-file .env -f docker-compose.yml "$@"
}

echo "PREVIEW_DEPLOY_PHASE=private_database"
compose_preview up -d postgres
for i in $(seq 1 35); do
  if compose_preview exec -T postgres pg_isready -U preview -d preview >/dev/null 2>&1; then break; fi
  sleep 2
done
compose_preview exec -T postgres pg_isready -U preview -d preview >/dev/null

# Rehearsal uses a CONSISTENT pg_dump snapshot, never touching live tables.
# Snapshot is saved only under the preview directory and deleted on exit.
PROD_DB="$(docker ps --filter name='betgenius-postgres-' --format '{{.ID}}' | head -1)"
test -n "$PROD_DB" || { echo "Production database container not found" >&2; exit 1; }
SNAPSHOT="$ROOT/.preview-snapshot.dump"
trap 'rm -f "$SNAPSHOT"' EXIT
docker exec "$PROD_DB" pg_dump --format=custom --no-owner --no-acl -U betgenius -d betgenius > "$SNAPSHOT"
test -s "$SNAPSHOT"
compose_preview stop app >/dev/null 2>&1 || true
compose_preview exec -T postgres dropdb --if-exists --force -U preview preview
compose_preview exec -T postgres createdb -U preview preview
compose_preview exec -T postgres pg_restore --no-owner --no-acl -U preview -d preview < "$SNAPSHOT"
rm -f "$SNAPSHOT"
trap - EXIT
echo "PREVIEW_DB_SNAPSHOT=isolated"

# Only now start the preview image. Its API and paid mutations will additionally
# be blocked at the external Caddy boundary, before reaching the app.
echo "PREVIEW_DEPLOY_PHASE=application"
compose_preview up -d app
READY=no
for i in $(seq 1 35); do
  if curl -fsS -m 5 http://127.0.0.1:3101/api/health >/dev/null 2>&1; then READY=yes; break; fi
  sleep 3
done
test "$READY" = yes || {
  echo "Preview app did not become healthy; production remains untouched" >&2
  compose_preview logs --tail=35 app || true
  exit 1
}
echo "PREVIEW_LOCAL_HEALTH=ok"

# An additive site file in SchoolKit's existing Caddy importer, not a change to
# the production betgenius.caddy or its container. Validate before reloading.
cd /opt/school-kit
. ./lib.sh
HASH="$(compose exec -T caddy caddy hash-password --plaintext "$PASSWORD" | tr -d '\r\n')"
test -n "$HASH"

# No protected routes, API actions, or methods other than GET/HEAD can reach
# staging. The preview shares no production cookies or mutable services.
cat > "$SITE.next" <<CADDY
preview.betgenius.ng {
  encode zstd gzip
  header {
    X-Robots-Tag "noindex, nofollow, noarchive"
    Cache-Control "private, no-store, max-age=0"
    Referrer-Policy "no-referrer"
    X-Frame-Options "DENY"
  }
  @writes {
    not method GET HEAD
  }
  respond @writes "Preview is read only" 405
  @blocked {
    path /api /api/* /admin /admin/* /dashboard /dashboard/* /login /register /pay /pay/* /email/* /notifications /following /reset-password /forgot-password
  }
  respond @blocked "Not available in preview" 404
  basic_auth {
    reviewer $HASH
  }
  reverse_proxy betgenius-preview-app:3000 {
    header_up X-Real-IP {client_ip}
  }
}
CADDY

if [ -f "$SITE" ]; then cp -p "$SITE" "$SITE.backup"; fi
mv "$SITE.next" "$SITE"
if ! compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  echo "Caddy preview config rejected; restoring original site" >&2
  if [ -f "$SITE.backup" ]; then mv "$SITE.backup" "$SITE"; else rm -f "$SITE"; fi
  exit 1
fi
if ! compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  echo "Caddy preview reload rejected; restoring original site" >&2
  if [ -f "$SITE.backup" ]; then mv "$SITE.backup" "$SITE"; else rm -f "$SITE"; fi
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
  exit 1
fi
rm -f "$SITE.backup"
echo "PREVIEW_CADDY_CONFIG=valid"

# Route checks use localhost with an overridden Host/SNI, so they work even
# before the preview DNS record exists. -k accommodates certificate issuance.
if curl -ksS -m 12 --resolve preview.betgenius.ng:443:127.0.0.1 -o /dev/null https://preview.betgenius.ng/ 2>/dev/null; then
  code_no_auth="$(curl -ksS -m 12 --resolve preview.betgenius.ng:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://preview.betgenius.ng/)"
  code_auth="$(curl -ksS -m 12 --resolve preview.betgenius.ng:443:127.0.0.1 --user "reviewer:$PASSWORD" -o /dev/null -w '%{http_code}' https://preview.betgenius.ng/)"
  code_post="$(curl -ksS -m 12 --resolve preview.betgenius.ng:443:127.0.0.1 --user "reviewer:$PASSWORD" -X POST -o /dev/null -w '%{http_code}' https://preview.betgenius.ng/api/admin/settle)"
  test "$code_no_auth" = 401 || { echo "Unauthorized request did not return 401 ($code_no_auth)" >&2; exit 1; }
  test "$code_auth" = 200 || { echo "Authenticated homepage did not return 200 ($code_auth)" >&2; exit 1; }
  test "$code_post" = 405 || test "$code_post" = 404 || { echo "Write block failed ($code_post)" >&2; exit 1; }
  echo "PREVIEW_AUTH=401_without_credentials"
  echo "PREVIEW_HOME=200_with_credentials"
  echo "PREVIEW_POST=blocked"
else
  # Caddy validates and starts the preview site even when the domain's DNS
  # has not been created. TLS will be testable after DNS points to this VPS.
  echo "PREVIEW_HTTPS_CHECK=pending_dns_and_certificate"
fi

# Print only RSA-encrypted credentials to PUBLIC Actions logs. Decryption key
# never enters this repository or the VPS. The plaintext stays mode-0600 here.
CIPHER="$(printf '%s' "$PASSWORD" | openssl pkeyutl -encrypt -pubin -inkey "$ROOT/credential-public.pem" -pkeyopt rsa_padding_mode:oaep | base64 -w0)"
echo "PREVIEW_PASSWORD_RSA_OAEP_BASE64=$CIPHER"
echo "PREVIEW_READY_INSIDE_VPS=yes"
