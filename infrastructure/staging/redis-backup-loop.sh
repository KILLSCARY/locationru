#!/bin/sh
set -eu

interval_seconds="${BACKUP_INTERVAL_SECONDS:-86400}"

case "$interval_seconds" in
  ''|*[!0-9]*)
    printf 'BACKUP_INTERVAL_SECONDS must be a positive integer\n' >&2
    exit 1
    ;;
esac

if [ "$interval_seconds" -lt 60 ]; then
  printf 'BACKUP_INTERVAL_SECONDS must be at least 60\n' >&2
  exit 1
fi

while true; do
  /bin/sh /opt/staging/redis-backup-once.sh
  sleep "$interval_seconds"
done
