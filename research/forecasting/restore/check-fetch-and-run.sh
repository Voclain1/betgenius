#!/usr/bin/env bash
# Check fetch-and-run.sh end to end with a FAKE rclone serving a SYNTHETIC dump.
# No network, no real credentials: the "secret" values below are fictional
# strings that must never appear in any log or output.
#
# Run from the repository root:  BGF_PYTHON=<venv python> bash research/forecasting/restore/check-fetch-and-run.sh
set -euo pipefail

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PG_BIN
: "${BGF_PYTHON:?set BGF_PYTHON to the research venv python}"
export BGF_PYTHON
REAL_MAJOR=$("$PG_BIN/pg_restore" --version | sed 's/[^0-9]*\([0-9]*\).*/\1/')

T=$(mktemp -d); chmod 755 "$T"
WORKREL="research/forecasting/work"
RUN=()
if [ "$(id -u)" = "0" ]; then
  id -u pgintegration >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin pgintegration
  chown pgintegration "$T"; RUN=(runuser -u pgintegration --)
fi
cleanup() { "${RUN[@]}" "${DUMP_PG_BIN:-$PG_BIN}/pg_ctl" -D "$T/src" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$T"; }
trap cleanup EXIT
mkdir -p "$WORKREL"
BEFORE=$(ls -1 "$WORKREL" | sort)

failures=0
check() {
  if [ "$2" = "0" ]; then echo "  PASS  $1"; else
    echo "  FAIL  $1"; failures=$((failures + 1))
    if [ -n "${3:-}" ] && [ -f "$3" ]; then sed 's/^/        | /' "$3" | tail -8; fi
  fi
  return 0
}

echo "building a synthetic dump and a fake R2 bucket…"
# shellcheck source=testlib-synthetic-dump.sh
. research/forecasting/restore/testlib-synthetic-dump.sh
bgf_build_synthetic_dump "$T" 55497 "$T/source.dump"
FAKE_PATH="secret-bucket-xyz/prod-prefix"
OBJECT="daily/betgenius-2026-11-14T1711Z.dump"
mkdir -p "$T/r2/$FAKE_PATH/daily"; cp "$T/source.dump" "$T/r2/$FAKE_PATH/$OBJECT"
BYTES=$(wc -c < "$T/source.dump"); SHA=$(sha256sum "$T/source.dump" | cut -d' ' -f1)

# Fake rclone: `copyto researchr2:<path> <dst> -q`. Logs each call; errors quote a URL and the path, as the real one can.
cat > "$T/rclone" <<FAKE
#!/bin/sh
echo "\$*" >> "$T/rclone.calls"
[ "\$1" = copyto ] || exit 2
src="\${2#researchr2:}"
if [ ! -f "$T/r2/\$src" ]; then echo "ERROR : https://acct.r2.cloudflarestorage.com/\$src: object not found" >&2; exit 3; fi
cp "$T/r2/\$src" "\$3"
FAKE
chmod +x "$T/rclone"

export RESEARCH_R2_PATH="$FAKE_PATH"
export RCLONE_CONFIG_RESEARCHR2_TYPE=s3 RCLONE_CONFIG_RESEARCHR2_PROVIDER=Cloudflare
export RCLONE_CONFIG_RESEARCHR2_ENDPOINT="https://acct.r2.cloudflarestorage.com"
export RCLONE_CONFIG_RESEARCHR2_ACCESS_KEY_ID="FAKE-ACCESS-KEY-ID-123"
export RCLONE_CONFIG_RESEARCHR2_SECRET_ACCESS_KEY="FAKE-SECRET-VALUE-456"
export RCLONE_CONFIG_RESEARCHR2_NO_CHECK_BUCKET=true
export BGF_TEST_RCLONE="$T/rclone" BGF_TEST_MIN_PG_MAJOR="$REAL_MAJOR"
FR=research/forecasting/restore/fetch-and-run.sh
fr() { bash "$FR" --object "$OBJECT" --expect-bytes "$BYTES" "$@"; }
calls() { [ -f "$T/rclone.calls" ] && wc -l < "$T/rclone.calls" || echo 0; }
empty_dir() { [ -z "$(ls -A "$1" 2>/dev/null)" ]; }

set +e
echo "refusals before any download:"
BGF_TEST_PROD_MARKERS="$T" fr --secure-dir "$T/s1" --confirm-encrypted-storage > "$T/l1.log" 2>&1
grep -q "looks like the production VPS" "$T/l1.log" && [ "$(calls)" = 0 ]; check "production host refused; nothing downloaded" $? "$T/l1.log"
RCLONE_CONFIG_BACKUP_TYPE=s3 fr --secure-dir "$T/s2" --confirm-encrypted-storage > "$T/l2.log" 2>&1
grep -q "production backup credentials" "$T/l2.log" && [ "$(calls)" = 0 ]; check "production backup credentials refused" $? "$T/l2.log"
RCLONE_CONFIG_RESEARCHR2_SECRET_ACCESS_KEY= fr --secure-dir "$T/s3" --confirm-encrypted-storage > "$T/l3.log" 2>&1
grep -q "RCLONE_CONFIG_RESEARCHR2_SECRET_ACCESS_KEY is not set" "$T/l3.log" && [ "$(calls)" = 0 ]; check "missing read-only credentials refused" $? "$T/l3.log"
RCLONE_CONFIG_RESEARCHR2_NO_CHECK_BUCKET= fr --secure-dir "$T/s4" --confirm-encrypted-storage > "$T/l4.log" 2>&1
grep -q "NO_CHECK_BUCKET must be true" "$T/l4.log" && [ "$(calls)" = 0 ]; check "remote without no_check_bucket refused" $? "$T/l4.log"
BGF_TEST_MIN_PG_MAJOR=$((REAL_MAJOR + 1)) fr --secure-dir "$T/s5" --confirm-encrypted-storage > "$T/l5.log" 2>&1
grep -q "refusing before downloading" "$T/l5.log" && [ "$(calls)" = 0 ]; check "Postgres older than the production dump refused before download" $? "$T/l5.log"
fr --secure-dir "$WORKREL/inside-repo-$$" --confirm-encrypted-storage > "$T/l6.log" 2>&1
grep -q "outside the repository" "$T/l6.log" && [ "$(calls)" = 0 ]; check "secure directory inside the repository refused" $? "$T/l6.log"
rmdir "$WORKREL/inside-repo-$$" 2>/dev/null
BGF_TEST_FORCE_UNENCRYPTED=1 fr --secure-dir "$T/s7" > "$T/l7.log" 2>&1
grep -q "cannot detect encryption" "$T/l7.log" && [ "$(calls)" = 0 ]; check "undetected encryption refused without explicit confirmation" $? "$T/l7.log"
bash "$FR" --object "../etc/passwd.dump" --expect-bytes 1 --secure-dir "$T/s8" --confirm-encrypted-storage > "$T/l8.log" 2>&1
grep -q "plain relative key" "$T/l8.log" && [ "$(calls)" = 0 ]; check "path-traversal object key refused" $? "$T/l8.log"

echo "download verification:"
bash "$FR" --object "$OBJECT" --expect-bytes $((BYTES + 1)) --secure-dir "$T/s9" --confirm-encrypted-storage > "$T/l9.log" 2>&1
grep -q "size mismatch" "$T/l9.log" && empty_dir "$T/s9"; check "size mismatch refused; nothing left behind" $? "$T/l9.log"
fr --expect-sha256 "$(printf '0%.0s' $(seq 64))" --secure-dir "$T/s10" --confirm-encrypted-storage > "$T/l10.log" 2>&1
grep -q "sha256 mismatch" "$T/l10.log" && empty_dir "$T/s10"; check "sha256 mismatch refused; nothing left behind" $? "$T/l10.log"
bash "$FR" --object "daily/missing.dump" --expect-bytes 1 --secure-dir "$T/s11" --confirm-encrypted-storage > "$T/l11.log" 2>&1
grep -q "download failed" "$T/l11.log" && ! grep -qE "cloudflarestorage|secret-bucket" "$T/l11.log" && empty_dir "$T/s11"
check "download error reported without endpoint or bucket path; nothing left behind" $? "$T/l11.log"

echo "failure inside the isolated run:"
BGF_TEST_FAIL_AT=extract fr --expect-sha256 "$SHA" --secure-dir "$T/s12" --confirm-encrypted-storage -- --quick > "$T/l12.log" 2>&1
grep -q "FAILED at stage: run" "$T/l12.log" && grep -q "dump deleted" "$T/l12.log" && empty_dir "$T/s12"
check "failed run: dump deleted, scratch removed, secure directory empty" $? "$T/l12.log"

echo "successful run:"
fr --expect-sha256 "$SHA" --secure-dir "$T/s13" --confirm-encrypted-storage -- --quick > "$T/l13.log" 2>&1
RC=$?
OUT=$(sed -n 's/^done: \([^ ]*\) .*/\1/p' "$T/l13.log" | tail -1)
[ "$RC" = 0 ] && [ -n "$OUT" ] && [ -f "$OUT/run/report.md" ]; check "full run produced a report" $? "$T/l13.log"
grep -q '"dump_deleted_after_run": true' "$OUT/fetch-receipt.json" 2>/dev/null && grep -q "\"sha256\": \"$SHA\"" "$OUT/fetch-receipt.json"
check "receipt records the object, hash and deletion" $? "$T/l13.log"
empty_dir "$T/s13"; check "dump and scratch database removed; secure directory empty" $? "$T/l13.log"
grep -q "scratch: $T/s13/tmp/" "$T/l13.log"; check "scratch database lived on the secure volume (TMPDIR)" $? "$T/l13.log"
[ "$(grep -c '' "$T/rclone.calls")" -ge 1 ] && ! grep -v "^copyto researchr2:" "$T/rclone.calls" | grep -q .
check "rclone was only ever asked to copy from the research remote" $?

echo "--keep-dump:"
fr --secure-dir "$T/s14" --confirm-encrypted-storage --keep-dump -- --extract-only > "$T/l14.log" 2>&1
[ -f "$T/s14/$(basename "$OBJECT")" ] && [ "$(stat -c %a "$T/s14/$(basename "$OBJECT")")" = 600 ]
check "--keep-dump keeps the dump, mode 0600" $? "$T/l14.log"

echo "leaks:"
{ cat "$T"/l*.log; find "$WORKREL" -newer "$T/source.dump" -type f -exec cat {} + 2>/dev/null; } > "$T/all.txt"
! grep -qE "FAKE-SECRET-VALUE-456|FAKE-ACCESS-KEY-ID-123" "$T/all.txt"; check "no credential value in any log or output" $?
! grep -q "secret-bucket-xyz" "$T/all.txt"; check "bucket/prefix never printed" $?
! grep -q "cloudflarestorage" "$T/all.txt"; check "endpoint never printed" $?
! grep -qE 'canary-user@example.invalid|CANARY-PROMPT' "$T/all.txt"; check "canaries never reached any log or output" $?

AFTER=$(ls -1 "$WORKREL" | sort)
for d in $(comm -13 <(echo "$BEFORE") <(echo "$AFTER")); do rm -rf "${WORKREL:?}/$d"; done
set -e
[ "$failures" = "0" ] && echo "all fetch-and-run checks passed" || { echo "$failures fetch-and-run check(s) FAILED"; exit 1; }
