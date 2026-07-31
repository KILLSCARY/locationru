import { AppEnvironment, parseAppEnvironment } from '@resilient-taxi/config';

import { SmsRuProvider } from '../src/auth/providers/sms-ru.provider.js';

/**
 * One-off, human-triggered verification that a real SMS.RU account is
 * correctly configured: sends one real transactional SMS (never an OTP
 * code — this never touches OtpService/the auth domain) to a phone number
 * the project owner supplies, then polls delivery status and checks the
 * account balance. Meant to be run once against staging after filling in
 * SMS_RU_API_ID, not as part of any automated test suite (see section 21
 * of docs/auth/otp-architecture.md) — that's why it is a standalone
 * script, not a Jest spec: it sends a real SMS and costs real money.
 *
 * Usage: STAGING_SMS_TEST_PHONE=+79991234567 pnpm staging:test:sms
 */

const RETRYABLE_STATUS_POLL_ATTEMPTS = 5;
const RETRYABLE_STATUS_POLL_DELAY_MS = 2_000;

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...data }));
}

function fail(message: string): never {
  log('staging_test_sms.failed', { message });
  process.exit(1);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const appEnvironment = parseAppEnvironment(
    process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
  );

  // Refuses production unconditionally, and refuses every non-staging tier
  // too — this script exists specifically to validate the staging SMS.RU
  // account before go-live, not as a general-purpose send-an-SMS tool.
  if (appEnvironment === AppEnvironment.PRODUCTION) {
    fail(
      'Refusing to run: APP_ENV=production. This script never runs against production.',
    );
  }
  if (appEnvironment !== AppEnvironment.STAGING) {
    fail(
      `Refusing to run: APP_ENV=${appEnvironment}, but this script only runs with APP_ENV=staging.`,
    );
  }

  const apiId = process.env.SMS_RU_API_ID;
  if (!apiId) {
    fail(
      'SMS_RU_API_ID is not set — fill it in from the SMS.RU cabinet first.',
    );
  }

  const testPhone = process.env.STAGING_SMS_TEST_PHONE;
  if (!testPhone) {
    fail(
      'STAGING_SMS_TEST_PHONE is not set — pass the phone number that should receive the real test SMS.',
    );
  }

  const config = {
    getOrThrow: <T>(key: string): T => {
      const values: Record<string, unknown> = {
        'sms.smsRu.apiId': apiId,
        'sms.smsRu.apiBaseUrl':
          process.env.SMS_RU_API_BASE_URL ?? 'https://sms.ru',
        'sms.smsRu.timeoutMs': Number(process.env.SMS_RU_TIMEOUT_MS ?? 10_000),
        'sms.smsRu.maxRetries': Number(process.env.SMS_RU_MAX_RETRIES ?? 2),
        'sms.smsRu.circuitFailureThreshold': Number(
          process.env.SMS_RU_CIRCUIT_FAILURE_THRESHOLD ?? 5,
        ),
        'sms.smsRu.circuitOpenMs': Number(
          process.env.SMS_RU_CIRCUIT_OPEN_MS ?? 30_000,
        ),
      };
      const value = values[key];
      if (value === undefined) throw new Error(`Missing config key: ${key}`);
      return value as T;
    },
    get: <T>(key: string): T | undefined => {
      if (key === 'sms.senderId') return (process.env.SMS_SENDER_ID ?? '') as T;
      return undefined;
    },
  };

  const provider = new SmsRuProvider(config as never);

  log('staging_test_sms.health_check.start');
  const health = await provider.healthCheck();
  log('staging_test_sms.health_check.result', { ...health });
  if (!health.healthy) {
    fail(`Health check failed: ${health.detail ?? 'unknown reason'}`);
  }

  log('staging_test_sms.balance.start');
  const balance = await provider.getBalance();
  log('staging_test_sms.balance.result', balance);

  log('staging_test_sms.send.start', { phone: maskPhone(testPhone) });
  const sendResult = await provider.sendTransactionalMessage({
    phone: testPhone,
    message:
      'Resilient Taxi: тестовое сообщение проверки интеграции SMS.RU (staging).',
  });
  log('staging_test_sms.send.result', { ...sendResult });

  if (!sendResult.providerMessageId) {
    fail(
      'Send succeeded but SMS.RU returned no providerMessageId — cannot poll status.',
    );
  }

  for (
    let attempt = 1;
    attempt <= RETRYABLE_STATUS_POLL_ATTEMPTS;
    attempt += 1
  ) {
    await sleep(RETRYABLE_STATUS_POLL_DELAY_MS);
    const status = await provider.getDeliveryStatus(
      sendResult.providerMessageId,
    );
    log('staging_test_sms.status_poll', { attempt, ...status });
    if (
      status.status === 'DELIVERED' ||
      status.status === 'FAILED' ||
      status.status === 'REJECTED'
    ) {
      log('staging_test_sms.done', { finalStatus: status.status });
      return;
    }
  }

  log('staging_test_sms.done', {
    finalStatus: 'UNKNOWN',
    note: 'Delivery did not reach a terminal status within the polling window — check the SMS.RU cabinet directly.',
  });
}

function maskPhone(phone: string): string {
  return phone.length > 4
    ? `${phone.slice(0, 2)}${'*'.repeat(phone.length - 4)}${phone.slice(-2)}`
    : phone;
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
