#!/usr/bin/env bash
# Runs the driver-verification staging smoke test
# (apps/api/scripts/staging-test-driver-verification.ts) inside a container
# built from the `migrate` service's image, against the staging docker
# network — so it can reach the API, Postgres, and Redis directly. Creates
# and deletes its own throwaway driver account; uploads go through the real
# object storage and document-processing pipeline. See
# docs/drivers/verification.md.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

compose run --rm migrate pnpm --filter @resilient-taxi/api staging:test:driver-verification
