#!/usr/bin/env bash
# Fetch ONE verified backup object from Cloudflare R2 straight to encrypted
# storage on an isolated machine, verify it, run the isolated research
# pipeline on it, and delete it. Owner-run; never on the production VPS, never
# in CI against real data.
#
#   export RESEARCH_R2_PATH='<bucket>/<prefix>'          # the value of BACKUP_BUCKET (bucket/prefix, not bucket-only)
#   export RCLONE_CONFIG_RESEARCHR2_TYPE=s3 RCLONE_CONFIG_RESEARCHR2_PROVIDER=Cloudflare \
#          RCLONE_CONFIG_RESEARCHR2_ENDPOINT='https://<account>.r2.cloudflarestorage.com' \
#          RCLONE_CONFIG_RESEARCHR2_NO_CHECK_BUCKET=true
#   # …and RCLONE_CONFIG_RESEARCHR2_ACCESS_KEY_ID / _SECRET_ACCESS_KEY from a
#   # password manager (e.g. `read -rs`), never typed on the command line.
#   bash research/forecasting/restore/fetch-and-run.sh \
#        --object daily/betgenius-2026-11-14T1711Z.dump --expect-bytes 29850681 \
#        --secure-dir /secure/bgf-research [--expect-sha256 <hex>] \
#        [--confirm-encrypted-storage] [--keep-dump] [-- <extra isolated-run.sh flags>]
#
# Least privilege. The remote MUST be a separate R2 API token with "Object
# Read" only, scoped to the backup bucket, short-lived, revoked afterwards.
# The production backup remote's credentials (RCLONE_CONFIG_BACKUP_*) are
# refused outright: they can write and delete backups.
#
# Data handling. The dump, the scratch database (TMPDIR) and the research
# outputs must all sit on encrypted storage: the script checks the secure
# directory and the repository checkout, and if it cannot detect encryption it
# requires --confirm-encrypted-storage. The secure directory must be outside
# the repository. Nothing printed names the bucket, endpoint or keys. The dump
# is deleted on success AND on failure unless --keep-dump.
#
# BGF_TEST_* variables are test seams (check-fetch-and-run.sh); a fake rclone
# can be supplied with BGF_TEST_RCLONE.
set -Eeuo pipefail

OBJECT=""; EXPECT_BYTES=""; EXPECT_SHA=""; SECURE=""; CONFIRM_ENC=0; KEEP_DUMP=0; PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --object) OBJECT="$2"; shift 2 ;;
    --expect-bytes) EXPECT_BYTES="$2"; shift 2 ;;
    --expect-sha256) EXPECT_SHA="$2"; shift 2 ;;
    --secure-dir) SECURE="$2"; shift 2 ;;
    --confirm-encrypted-storage) CONFIRM_ENC=1; shift ;;
    --keep-dump) KEEP_DUMP=1; shift ;;
    --) shift; PASS=("$@"); break ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

STAGE="arguments"; DUMP=""; PARTIAL=""; SCRATCH=""
die() { echo "REFUSED: $*" >&2; exit 1; }
step() { STAGE="$1"; echo; echo "══ $1: $2"; }
scrub() { sed -E 's#https?://[^[:space:]]+#<redacted-url>#g; s#researchr2:[^[:space:]]+#researchr2:<redacted-path>#g'; }
wipe() { # best-effort overwrite, then unlink
  [ -e "$1" ] || return 0
  if command -v shred >/dev/null 2>&1; then shred -u -z "$1" 2>/dev/null || rm -f "$1"; else rm -f "$1"; fi
}
on_exit() {
  local code=$?
  trap - EXIT INT TERM
  [ -n "$PARTIAL" ] && wipe "$PARTIAL"
  if [ -n "$DUMP" ] && [ -e "$DUMP" ]; then
    if [ "$KEEP_DUMP" = "1" ] && [ "$code" = "0" ]; then echo "   dump kept (--keep-dump): $DUMP — delete it when finished"
    else wipe "$DUMP"; echo "   dump deleted"; fi
  fi
  [ -n "$SCRATCH" ] && rm -rf "$SCRATCH"
  [ "$code" = "0" ] || echo "FAILED at stage: $STAGE (exit $code)" >&2
  exit "$code"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for v in $(env | sed -n 's/^\(BGF_TEST_[A-Z_]*\)=.*/\1/p'); do echo "!! TEST HOOK ACTIVE: $v — never set this for a real run" >&2; done

[ -f package.json ] && [ -d research/forecasting ] || die "run from the repository root"
REPO=$(pwd -P)

# ── host: refuse before touching anything ──────────────────────────────────
step host "refuse the production VPS"
# shellcheck source=lib-host-check.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib-host-check.sh"
if HOST_REASON=$(bgf_production_host_reason); then die "$HOST_REASON"; fi
echo "   not the production host"

# ── inputs ─────────────────────────────────────────────────────────────────
step inputs "object, size, credentials (names only), tools"
[ -n "$OBJECT" ] || die "--object <key under RESEARCH_R2_PATH> is required (e.g. daily/betgenius-2026-11-14T1711Z.dump)"
case "$OBJECT" in /*|*..*|*' '*) die "--object must be a plain relative key";; esac
case "$OBJECT" in *.dump) ;; *) die "--object must name a .dump file";; esac
[[ "$EXPECT_BYTES" =~ ^[0-9]+$ ]] || die "--expect-bytes <exact size> is required (the size recorded when the backup was verified)"
[ -z "$EXPECT_SHA" ] || [[ "$EXPECT_SHA" =~ ^[0-9a-f]{64}$ ]] || die "--expect-sha256 must be 64 lowercase hex characters"
[ -n "$SECURE" ] || die "--secure-dir <directory on encrypted storage> is required"
[ -n "${RESEARCH_R2_PATH:-}" ] || die "RESEARCH_R2_PATH is not set (the BACKUP_BUCKET value: bucket/prefix)"
if env | grep -q '^RCLONE_CONFIG_BACKUP_'; then
  die "RCLONE_CONFIG_BACKUP_* is set: those are the production backup credentials (write/delete). Use a separate read-only token as the 'researchr2' remote."
fi
for k in TYPE ENDPOINT ACCESS_KEY_ID SECRET_ACCESS_KEY; do
  v="RCLONE_CONFIG_RESEARCHR2_$k"; [ -n "${!v:-}" ] || die "$v is not set (see the header of this script)"
done
[ "${RCLONE_CONFIG_RESEARCHR2_NO_CHECK_BUCKET:-}" = "true" ] || die "RCLONE_CONFIG_RESEARCHR2_NO_CHECK_BUCKET must be true (a read-only R2 token cannot check or create buckets)"
RCLONE="${BGF_TEST_RCLONE:-rclone}"
command -v "$RCLONE" >/dev/null 2>&1 || die "rclone not found"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PG_BIN/pg_restore" ] || die "Postgres binaries not found (set PG_BIN)"
LOCAL_MAJOR=$("$PG_BIN/pg_restore" --version | sed 's/[^0-9]*\([0-9]*\).*/\1/')
MIN_MAJOR="${BGF_TEST_MIN_PG_MAJOR:-17}"
[ "$LOCAL_MAJOR" -ge "$MIN_MAJOR" ] || die "local Postgres is $LOCAL_MAJOR; production dumps are written by pg_dump 17. Install Postgres 17 (or newer) and set PG_BIN — refusing before downloading."
export PG_BIN
echo "   object $OBJECT, expected $EXPECT_BYTES bytes; remote credentials present (values not shown); Postgres $LOCAL_MAJOR"

# ── storage: private, outside the repo, encrypted ─────────────────────────
step storage "secure directory"
mkdir -p "$SECURE"; chmod 700 "$SECURE"
SECURE=$(cd "$SECURE" && pwd -P)
[ "$(stat -c %u "$SECURE")" = "$(id -u)" ] || die "$SECURE is not owned by the current user"
case "$SECURE/" in "$REPO"/*) die "--secure-dir must be outside the repository checkout";; esac
is_encrypted() { # best effort: dm-crypt/LUKS ancestry, or an encrypting filesystem
  local src fstype
  [ -z "${BGF_TEST_FORCE_UNENCRYPTED:-}" ] || return 1
  src=$(findmnt -n -o SOURCE -T "$1" 2>/dev/null | head -1) || return 1
  fstype=$(findmnt -n -o FSTYPE -T "$1" 2>/dev/null | head -1)
  case "$fstype" in ecryptfs|fuse.gocryptfs|fuse.cryfs) return 0;; esac
  [ -b "$src" ] && lsblk -s -n -o TYPE "$src" 2>/dev/null | grep -qx crypt
}
for d in "$SECURE" "$REPO"; do
  if ! is_encrypted "$d"; then
    [ "$CONFIRM_ENC" = "1" ] || die "cannot detect encryption for $d. Put the secure directory AND the repository checkout on encrypted storage, then re-run with --confirm-encrypted-storage."
    echo "   encryption of $d not detected automatically; confirmed by the operator (--confirm-encrypted-storage)"
  else
    echo "   $d is on encrypted storage"
  fi
done
NEED=$(( EXPECT_BYTES * 6 ))   # dump + restored tables + scratch WAL, generously
AVAIL=$(( $(df -Pk "$SECURE" | awk 'NR==2 {print $4}') * 1024 ))
[ "$AVAIL" -ge "$NEED" ] || die "not enough space in the secure directory (need about $NEED bytes)"

# ── fetch: directly from R2, read-only ─────────────────────────────────────
step fetch "download one object"
umask 077
NAME=$(basename "$OBJECT")
DUMP="$SECURE/$NAME"
[ ! -e "$DUMP" ] || die "$DUMP already exists; remove it or choose another --secure-dir"
PARTIAL="$DUMP.partial"
"$RCLONE" copyto "researchr2:$RESEARCH_R2_PATH/$OBJECT" "$PARTIAL" -q 2> "$SECURE/.rclone.err" \
  || { msg=$(head -2 "$SECURE/.rclone.err" | scrub); rm -f "$SECURE/.rclone.err"; die "download failed: $msg"; }
rm -f "$SECURE/.rclone.err"
GOT=$(stat -c %s "$PARTIAL")
[ "$GOT" = "$EXPECT_BYTES" ] || die "size mismatch: got $GOT bytes, expected $EXPECT_BYTES"
SHA=$(sha256sum "$PARTIAL" | cut -d' ' -f1)
[ -z "$EXPECT_SHA" ] || [ "$SHA" = "$EXPECT_SHA" ] || die "sha256 mismatch"
mv "$PARTIAL" "$DUMP"; PARTIAL=""
chmod 600 "$DUMP"
echo "   $GOT bytes, sha256 $SHA, stored 0600 in the secure directory"

# ── run: every scratch byte on the secure volume ───────────────────────────
step run "isolated restore and evaluation"
SCRATCH="$SECURE/tmp"; mkdir -m 700 "$SCRATCH"
[ "$(id -u)" != "0" ] || chmod 711 "$SECURE" "$SCRATCH"   # lets the unprivileged postgres user traverse to its own 0700 dir
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="research/forecasting/work/real-$STAMP"
TMPDIR="$SCRATCH" bash research/forecasting/restore/isolated-run.sh --dump "$DUMP" --out "$OUT" "${PASS[@]}"
STAGE="receipt"
cat > "$OUT/fetch-receipt.json" <<JSON
{"object": "$OBJECT", "bytes": $GOT, "sha256": "$SHA", "fetched_at": "$STAMP", "dump_deleted_after_run": $([ "$KEEP_DUMP" = "1" ] && echo false || echo true)}
JSON
STAGE="done"
echo; echo "done: $OUT (report: $OUT/run/report.md)"
