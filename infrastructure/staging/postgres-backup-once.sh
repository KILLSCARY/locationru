#!/bin/sh
set -eu

backup_dir="${BACKUP_DIR:-/backups}"
retention_days="${BACKUP_RETENTION_DAYS:-7}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$backup_dir/postgres-$timestamp.dump"
temporary_path="$backup_path.tmp"

mkdir -p "$backup_dir"
pg_dump \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file="$temporary_path"
pg_restore --list "$temporary_path" >/dev/null
mv "$temporary_path" "$backup_path"

find "$backup_dir" \
  -type f \
  -name 'postgres-*.dump' \
  -mtime "+$retention_days" \
  -delete

printf '{"event":"staging.backup.completed","path":"%s"}\n' "$backup_path"
