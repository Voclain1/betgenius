#!/bin/sh
# Restores the newest daily backup into a scratch database and compares row
# counts with the live one. Run monthly by db-restore-test.yml. A backup that
# has never been restored is not a backup.
set -eu
. /ops/env.sh
latest=$(rclone lsf "backup:${BACKUP_BUCKET}/daily" | sort | tail -1)
[ -n "$latest" ] || { echo "no backups found"; exit 1; }
echo "restoring $latest"
rclone copyto "backup:${BACKUP_BUCKET}/daily/${latest}" /tmp/restore.dump
trap 'rm -f /tmp/restore.dump; dropdb --if-exists restore_test' EXIT

dropdb --if-exists restore_test
createdb restore_test
pg_restore --no-owner -d restore_test /tmp/restore.dump

status=0
for table in User Prediction Subscription PaymentAttempt; do
  live=$(psql -tAc "SELECT count(*) FROM \"$table\"")
  restored=$(psql -d restore_test -tAc "SELECT count(*) FROM \"$table\"")
  echo "$table: live=$live restored=$restored"
  # The dump is from last night, so counts may trail; an empty copy of a
  # non-empty table is the failure.
  if [ "$live" -gt 0 ] && [ "$restored" -eq 0 ]; then status=1; fi
done
exit $status
