#!/bin/sh
set -eu

backup_dir="${YANDEX_BACKUP_DIR:-/opt/resilient-taxi/.staging/yandex-backups}"
bucket="${YANDEX_BACKUP_BUCKET:?YANDEX_BACKUP_BUCKET is required}"
metadata_base_url="http://169.254.169.254/computeMetadata/v1"
token_url="$metadata_base_url/instance/service-accounts/default/token"

if [ ! -d "$backup_dir" ]; then
  printf 'Backup directory does not exist: %s\n' "$backup_dir" >&2
  exit 1
fi

token="$(
  curl \
    --fail \
    --silent \
    --show-error \
    --header 'Metadata-Flavor: Google' \
    "$token_url" |
    jq --raw-output '.access_token // empty'
)"

if [ -z "$token" ]; then
  printf 'The VM metadata service returned no IAM token\n' >&2
  exit 1
fi

uploaded=0

for pattern in 'postgres-*.dump' 'redis-*.rdb'; do
  for backup_path in "$backup_dir"/$pattern; do
    [ -e "$backup_path" ] || continue

    marker_path="$backup_path.uploaded"
    [ ! -e "$marker_path" ] || continue

    backup_name="$(basename "$backup_path")"
    object_url="https://storage.yandexcloud.net/$bucket/backups/$backup_name"

    curl \
      --fail \
      --silent \
      --show-error \
      --request PUT \
      --upload-file "$backup_path" \
      --header "Authorization: Bearer $token" \
      "$object_url"

    touch "$marker_path"
    uploaded=$((uploaded + 1))
    printf '{"event":"yandex.backup.uploaded","object":"backups/%s"}\n' "$backup_name"
  done
done

for marker_path in "$backup_dir"/*.uploaded; do
  [ -e "$marker_path" ] || continue
  backup_path="${marker_path%.uploaded}"
  [ -e "$backup_path" ] || rm -f "$marker_path"
done

printf '{"event":"yandex.backup.upload.completed","count":%s}\n' "$uploaded"
