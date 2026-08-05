#!/bin/sh
set -eu

mc alias set staging "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing "staging/$MINIO_BACKUP_BUCKET"
mc anonymous set none "staging/$MINIO_BACKUP_BUCKET"
