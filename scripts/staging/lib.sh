#!/usr/bin/env bash
# Shared helpers for scripts/staging/*.sh — sourced, not executed directly.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${STAGING_ENV_FILE:-$ROOT_DIR/.env.staging}"
COMPOSE_FILE="$ROOT_DIR/docker-compose.staging.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy .env.staging.example and fill in secrets first." >&2
  exit 1
fi

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# Reads a single KEY=value out of $ENV_FILE without exporting the whole
# file (avoids leaking every staging secret into this script's env).
env_var() {
  local key="$1"
  local default="${2:-}"
  local value
  value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d'=' -f2- || true)"
  echo "${value:-$default}"
}

BACKUP_DIR="$(env_var STAGING_BACKUP_DIR "$ROOT_DIR/.staging-backups")"
RETENTION_DAYS="$(env_var STAGING_BACKUP_RETENTION_DAYS 14)"
POSTGRES_USER="$(env_var POSTGRES_USER)"
POSTGRES_DB="$(env_var POSTGRES_DB)"

if [[ -z "$POSTGRES_USER" || -z "$POSTGRES_DB" ]]; then
  echo "POSTGRES_USER/POSTGRES_DB must be set in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
