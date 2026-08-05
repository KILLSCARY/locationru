#!/usr/bin/env bash
# Runs the full staging smoke test (apps/api/scripts/staging-smoke.ts)
# inside a one-off container built from the `migrate` service's image, so
# it can reach Postgres/Redis/MinIO/api directly over the docker network.
# Exits non-zero if the smoke test fails — see docs/staging/smoke-tests.md.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

compose run --rm migrate pnpm --filter @resilient-taxi/api staging:smoke
