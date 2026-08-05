#!/bin/sh
set -eu

interval_seconds="${BACKUP_SYNC_INTERVAL_SECONDS:-60}"

mc alias set staging "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

while true; do
  mc mirror \
    --overwrite \
    --remove \
    /backups \
    "staging/$MINIO_BACKUP_BUCKET"
  sleep "$interval_seconds"
done
