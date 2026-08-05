#!/usr/bin/env bash
# Runs the idempotent staging fixture seed (prisma/seed-staging.ts) inside
# a one-off container built from the `migrate` service's image (the
# `build` stage, which has the full monorepo + devDependencies + tsx —
# the pruned runtime `api` image intentionally doesn't).

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

compose run --rm migrate pnpm --filter @resilient-taxi/api db:seed:staging
