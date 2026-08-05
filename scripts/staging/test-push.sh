#!/usr/bin/env bash
# Runs the push-notifications staging verification
# (apps/api/scripts/staging-test-push.ts) inside a container built from the
# `migrate` service's image, against the staging docker network — so it can
# reach both the API and Redis directly. Never sends a real FCM/APNs push:
# the send step always goes through DevelopmentPushProvider via the
# staging-only admin test-send tool. See docs/notifications/monitoring.md.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

compose run --rm migrate pnpm --filter @resilient-taxi/api staging:test:push
