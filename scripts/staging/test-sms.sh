#!/usr/bin/env bash
# Runs the one-off SMS.RU staging verification
# (apps/api/scripts/staging-test-sms.ts) inside a container built from the
# `migrate` service's image, using the real SMS_RU_API_ID from
# .env.staging. Sends one real SMS and costs real money — see
# docs/auth/sms-ru-setup.md before running this.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [[ -z "${STAGING_SMS_TEST_PHONE:-}" ]]; then
  echo "STAGING_SMS_TEST_PHONE must be set to the phone that should receive the test SMS, e.g.:" >&2
  echo "  STAGING_SMS_TEST_PHONE=+79991234567 pnpm staging:test:sms" >&2
  exit 1
fi

compose run --rm -e STAGING_SMS_TEST_PHONE migrate pnpm --filter @resilient-taxi/api staging:test:sms
