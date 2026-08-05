#!/usr/bin/env bash
# Dumps the staging Postgres database in pg_dump's custom format (-Fc),
# timestamps it, and writes a sha256 checksum alongside it. Old backups
# past STAGING_BACKUP_RETENTION_DAYS are pruned. Exits non-zero on any
# failure — this is meant to be safe to run from a daily cron/systemd timer
# without a human watching it.
#
# RPO/RTO: this being the only backup mechanism means the practical RPO is
# "since the last successful run of this script" — run it at least daily
# (see docs/staging/backups.md for the recommended cron). RTO is however
# long `restore.sh` + migration catch-up takes, which for the vast
# majority of any custom-format dump size here should be well under 15
# minutes on staging-scale data volumes.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="$BACKUP_DIR/resilient-taxi-staging-${timestamp}.dump"

echo "Backing up ${POSTGRES_DB} to ${dump_file} ..."

compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F c >"$dump_file"

if [[ ! -s "$dump_file" ]]; then
  echo "pg_dump produced an empty file — treating this as a failed backup." >&2
  rm -f "$dump_file"
  exit 1
fi

sha256sum "$dump_file" >"${dump_file}.sha256"
echo "Wrote $(basename "$dump_file") ($(du -h "$dump_file" | cut -f1))"

echo "Pruning backups older than ${RETENTION_DAYS} days ..."
find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -mtime "+${RETENTION_DAYS}" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -name '*.dump.sha256' -mtime "+${RETENTION_DAYS}" -print -delete

echo "Backup complete."
