#!/usr/bin/env bash
# Lists available staging backups with size, timestamp, and whether the
# stored checksum still matches the file on disk.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

shopt -s nullglob
dumps=("$BACKUP_DIR"/*.dump)

if [[ ${#dumps[@]} -eq 0 ]]; then
  echo "No backups found in $BACKUP_DIR"
  exit 0
fi

printf '%-40s %-10s %-20s %s\n' 'FILE' 'SIZE' 'MODIFIED' 'CHECKSUM'
for dump_file in "${dumps[@]}"; do
  size="$(du -h "$dump_file" | cut -f1)"
  modified="$(date -r "$dump_file" -u +'%Y-%m-%d %H:%M:%SZ')"
  checksum_file="${dump_file}.sha256"
  if [[ -f "$checksum_file" ]] && sha256sum -c "$checksum_file" --status 2>/dev/null; then
    checksum_status='ok'
  elif [[ -f "$checksum_file" ]]; then
    checksum_status='MISMATCH'
  else
    checksum_status='missing'
  fi
  printf '%-40s %-10s %-20s %s\n' "$(basename "$dump_file")" "$size" "$modified" "$checksum_status"
done
