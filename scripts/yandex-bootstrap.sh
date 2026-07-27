#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo 'Run this script with sudo.' >&2
  exit 1
fi

repository_dir="${RESILIENT_TAXI_DIR:-/opt/resilient-taxi}"
deploy_user="${SUDO_USER:-killscary}"
backup_bucket="${YANDEX_BACKUP_BUCKET:-resilient-taxi-staging-b1gretmvme2glnupmsog}"
metadata_base_url="http://169.254.169.254/computeMetadata/v1"
external_ip_url="$metadata_base_url/instance/network-interfaces/0/access-configs/0/external-ip"

if [[ ! -f "$repository_dir/docker-compose.yandex.yml" ]]; then
  echo "Repository is not present at $repository_dir." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --yes ca-certificates curl git jq docker.io docker-compose-v2

systemctl enable --now docker
usermod --append --groups docker "$deploy_user"

external_ip="$(
  curl \
    --fail \
    --silent \
    --show-error \
    --header 'Metadata-Flavor: Google' \
    "$external_ip_url"
)"

if [[ -z "$external_ip" ]]; then
  echo 'The VM has no public IPv4 address.' >&2
  exit 1
fi

base_domain="$external_ip.sslip.io"

cd "$repository_dir"

if [[ ! -f .env.staging ]]; then
  docker run \
    --rm \
    --volume "$repository_dir:/workspace" \
    --workdir /workspace \
    node:22-alpine \
    node scripts/staging-env-init.mjs
fi

sed --in-place \
  --expression '/^YANDEX_BASE_DOMAIN=/d' \
  --expression '/^YANDEX_BACKUP_BUCKET=/d' \
  .env.staging
printf '\nYANDEX_BASE_DOMAIN=%s\nYANDEX_BACKUP_BUCKET=%s\n' \
  "$base_domain" \
  "$backup_bucket" \
  >>.env.staging

mkdir --parents .staging/yandex-backups /etc/resilient-taxi
chown --recursive "$deploy_user:$deploy_user" .env.staging .staging
chmod 600 .env.staging

install \
  --mode 0644 \
  infrastructure/yandex/resilient-taxi-backup.service \
  /etc/systemd/system/resilient-taxi-backup.service
install \
  --mode 0644 \
  infrastructure/yandex/resilient-taxi-backup.timer \
  /etc/systemd/system/resilient-taxi-backup.timer
printf 'YANDEX_BACKUP_BUCKET=%s\nYANDEX_BACKUP_DIR=%s\n' \
  "$backup_bucket" \
  "$repository_dir/.staging/yandex-backups" \
  >/etc/resilient-taxi/yandex-backup.env
chmod 0640 /etc/resilient-taxi/yandex-backup.env
chown root:"$deploy_user" /etc/resilient-taxi/yandex-backup.env

export COMPOSE_PARALLEL_LIMIT=1
docker compose \
  --env-file .env.staging \
  --file docker-compose.yandex.yml \
  up \
  --detach \
  --build \
  --wait

systemctl daemon-reload
systemctl enable --now resilient-taxi-backup.timer
systemctl start resilient-taxi-backup.service

echo
echo 'Resilient Taxi staging is running:'
echo "  API:   https://api.$base_domain/api/v1/health"
echo "  Admin: https://admin.$base_domain"
echo
echo 'The test OTP is 111111. Development SMS and payment providers are active.'
