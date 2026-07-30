#!/usr/bin/env bash
# Restores a staging Postgres backup. This is destructive (drops and
# recreates every object in the target database), so it:
#   1. Requires an explicit --yes flag — refuses to run interactively
#      without it, and refuses non-interactively without it too.
#   2. Always takes a fresh backup of the CURRENT database first, so a
#      restore mistake is itself recoverable.
#   3. Verifies the chosen dump's checksum before touching the database.
#
# Usage: scripts/staging/restore.sh --yes [path/to/backup.dump]
# With no path given, restores the most recent backup in STAGING_BACKUP_DIR.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

confirmed=false
dump_file=""

for arg in "$@"; do
  case "$arg" in
    --yes) confirmed=true ;;
    *) dump_file="$arg" ;;
  esac
done

if [[ "$confirmed" != true ]]; then
  echo "Refusing to restore without --yes. This overwrites the staging database." >&2
  echo "Usage: scripts/staging/restore.sh --yes [path/to/backup.dump]" >&2
  exit 1
fi

if [[ -z "$dump_file" ]]; then
  dump_file="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n1 | cut -d' ' -f2-)"
  if [[ -z "$dump_file" ]]; then
    echo "No backup file given and none found in $BACKUP_DIR" >&2
    exit 1
  fi
  echo "No backup path given — using the most recent: $dump_file"
fi

if [[ ! -f "$dump_file" ]]; then
  echo "Backup file not found: $dump_file" >&2
  exit 1
fi

checksum_file="${dump_file}.sha256"
if [[ -f "$checksum_file" ]]; then
  echo "Verifying checksum ..."
  if ! sha256sum -c "$checksum_file"; then
    echo "Checksum mismatch — refusing to restore a possibly-corrupt backup." >&2
    exit 1
  fi
else
  echo "WARNING: no checksum file found for $dump_file, skipping verification." >&2
fi

echo "Backing up the current database before restoring over it ..."
"$(dirname "${BASH_SOURCE[0]}")/backup.sh"

echo "Restoring $dump_file into ${POSTGRES_DB} ..."
compose exec -T postgres pg_restore \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists --no-owner --no-privileges \
  <"$dump_file"

echo "Restore complete. Run 'pnpm --filter @resilient-taxi/api db:migrate:deploy' if this backup predates a migration that's since shipped."
