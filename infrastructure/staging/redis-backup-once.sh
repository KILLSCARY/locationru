#!/bin/sh
set -eu

backup_dir="${BACKUP_DIR:-/backups}"
retention_days="${BACKUP_RETENTION_DAYS:-7}"
redis_host="${REDIS_HOST:-redis}"
redis_port="${REDIS_PORT:-6379}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$backup_dir/redis-$timestamp.rdb"
temporary_path="$backup_path.tmp"

mkdir -p "$backup_dir"
redis-cli \
  -h "$redis_host" \
  -p "$redis_port" \
  --rdb "$temporary_path"
redis-check-rdb "$temporary_path" >/dev/null
mv "$temporary_path" "$backup_path"

find "$backup_dir" \
  -type f \
  -name 'redis-*.rdb' \
  -mtime "+$retention_days" \
  -delete

printf '{"event":"staging.redis_backup.completed","path":"%s"}\n' "$backup_path"
