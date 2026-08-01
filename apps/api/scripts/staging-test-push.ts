import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';

import {
  STAGING_SUPER_ADMIN_PHONE,
  STAGING_TEST_DRIVER_PHONE,
  STAGING_TEST_PASSENGER_PHONE,
} from '../src/staging-tools/staging-test-accounts.js';
import { stagingOtpLookupKey } from '../src/auth/providers/staging-sms.provider.js';

/**
 * Push-notifications smoke test against a running staging deployment: full
 * device-token lifecycle, preference enforcement, an end-to-end send driven
 * through the real outbox pipeline (via the staging-only test-send tool —
 * never a real FCM/APNs call, DevelopmentPushProvider only), the inbox
 * read/opened flow, and the admin monitoring surface. Exits non-zero on any
 * failure. Mirrors staging-smoke.ts's HTTP-against-a-live-deployment style
 * rather than staging-test-sms.ts's in-process-provider style, since this
 * exercises the full stack (auth -> device registration -> outbox ->
 * inbox -> admin), not a single provider call.
 *
 * Usage: pnpm staging:test:push
 * (Run inside the staging docker network, same as staging-smoke.ts, so it
 * can reach Redis directly for the SUPER_ADMIN OTP bootstrap.)
 */

const API_URL = process.env.STAGING_SMOKE_API_URL ?? 'http://api:3000/api/v1';
const REDIS_URL = process.env.REDIS_URL;

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...data }));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new Error(`Push smoke test assertion failed: ${message}`);
}

async function api<T>(
  token: string | undefined,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const data = (text ? JSON.parse(text) : undefined) as T;
  return { status: response.status, data };
}

async function bootstrapSuperAdminToken(redis: Redis): Promise<string> {
  await api(undefined, 'POST', '/auth/request-code', {
    phone: STAGING_SUPER_ADMIN_PHONE,
  });
  const code = await redis.get(stagingOtpLookupKey(STAGING_SUPER_ADMIN_PHONE));
  assert(code, 'SUPER_ADMIN OTP was not found in Redis');
  const { data } = await api<{ accessToken: string }>(
    undefined,
    'POST',
    '/auth/verify-code',
    {
      phone: STAGING_SUPER_ADMIN_PHONE,
      code,
      deviceId: 'push-smoke-super-admin',
      platform: 'WEB',
    },
  );
  return data.accessToken;
}

async function loginViaOtpViewer(
  superAdminToken: string,
  phone: string,
  deviceId: string,
  platform: 'ANDROID' | 'WEB',
): Promise<{ accessToken: string; userId: string }> {
  await api(undefined, 'POST', '/auth/request-code', { phone });
  const { data: otp } = await api<{ code: string | null }>(
    superAdminToken,
    'GET',
    `/admin/staging/otp/${encodeURIComponent(phone)}`,
  );
  assert(otp.code, `No OTP found for ${phone} via the admin viewer endpoint`);
  const { data: tokens } = await api<{ accessToken: string }>(
    undefined,
    'POST',
    '/auth/verify-code',
    { phone, code: otp.code, deviceId, platform },
  );
  const { data: me } = await api<{ id: string }>(
    tokens.accessToken,
    'GET',
    '/auth/me',
  );
  return { accessToken: tokens.accessToken, userId: me.id };
}

async function main(): Promise<void> {
  if (!REDIS_URL) throw new Error('REDIS_URL is required');
  const redis = new Redis(REDIS_URL);

  try {
    // 1. Health check.
    const health = await api<{ status: string }>(undefined, 'GET', '/health');
    assert(health.data.status === 'ok', 'API health check failed');
    log('1.health.ok');

    // 2. SUPER_ADMIN bootstrap.
    const superAdminToken = await bootstrapSuperAdminToken(redis);
    log('2.auth.super_admin_ok');

    // 3-4. Passenger and driver login.
    const passenger = await loginViaOtpViewer(
      superAdminToken,
      STAGING_TEST_PASSENGER_PHONE,
      'push-smoke-passenger',
      'WEB',
    );
    const driver = await loginViaOtpViewer(
      superAdminToken,
      STAGING_TEST_DRIVER_PHONE,
      'push-smoke-driver',
      'ANDROID',
    );
    log('3-4.auth.test_accounts_ok', {
      passengerId: passenger.userId,
      driverId: driver.userId,
    });

    // 5-6. Device token registration (passenger + driver).
    const { data: passengerDevice } = await api<{ id: string }>(
      passenger.accessToken,
      'POST',
      '/notifications/devices',
      {
        deviceId: 'push-smoke-passenger-device',
        platform: 'ANDROID',
        pushToken: `push-smoke-passenger-token-${randomUUID()}`,
        notificationsPermission: true,
      },
    );
    const { data: driverDevice } = await api<{ id: string }>(
      driver.accessToken,
      'POST',
      '/notifications/devices',
      {
        deviceId: 'push-smoke-driver-device',
        platform: 'ANDROID',
        pushToken: `push-smoke-driver-token-${randomUUID()}`,
        notificationsPermission: true,
      },
    );
    log('5-6.devices.registered', {
      passengerDeviceId: passengerDevice.id,
      driverDeviceId: driverDevice.id,
    });

    // 7. Passenger sees exactly the one device just registered.
    const { data: passengerDevices } = await api<Array<{ id: string }>>(
      passenger.accessToken,
      'GET',
      '/notifications/devices',
    );
    assert(
      passengerDevices.some((device) => device.id === passengerDevice.id),
      'Registered device token not found in GET /notifications/devices',
    );
    log('7.devices.list_ok', { count: passengerDevices.length });

    // 8-10. Preferences: read current state (never asserted against a
    // fixed baseline — this is a persistent staging account a prior run
    // may have already customized), then a write/read-back round trip for
    // PAYMENTS, plus the SECURITY floor that no write can ever lift.
    const { data: before } = await api<{
      categories: Array<{ category: string; pushEnabled: boolean }>;
    }>(passenger.accessToken, 'GET', '/notifications/preferences');
    assert(
      before.categories.length === 6,
      `Expected 6 categories, got ${before.categories.length}`,
    );
    log('8.preferences.read_ok');

    const nextPaymentsState = !before.categories.find(
      (entry) => entry.category === 'PAYMENTS',
    )?.pushEnabled;
    const { data: updated } = await api<{
      categories: Array<{ category: string; pushEnabled: boolean }>;
    }>(passenger.accessToken, 'PUT', '/notifications/preferences', {
      categories: [
        { category: 'PAYMENTS', pushEnabled: nextPaymentsState },
        { category: 'SECURITY', pushEnabled: false },
      ],
    });
    const payments = updated.categories.find((c) => c.category === 'PAYMENTS');
    const security = updated.categories.find((c) => c.category === 'SECURITY');
    assert(
      payments?.pushEnabled === nextPaymentsState,
      'PUT /notifications/preferences did not persist the PAYMENTS toggle',
    );
    assert(
      security?.pushEnabled === true,
      'SECURITY must never actually be disabled, even on request',
    );
    log('9-10.preferences.update_ok');

    // 11. Real end-to-end send via the staging test-send tool
    // (DevelopmentPushProvider only — no real FCM/APNs call is ever made).
    const { data: sendResult } = await api<{
      outboxStatus: string;
      notificationStatus: string;
      notificationId: string;
    }>(superAdminToken, 'POST', '/admin/staging/push/test-send', {
      userId: passenger.userId,
      application: 'PASSENGER',
    });
    assert(
      sendResult.outboxStatus === 'DELIVERED',
      `Expected outbox DELIVERED, got ${sendResult.outboxStatus}`,
    );
    assert(
      sendResult.notificationStatus === 'SENT',
      `Expected notification SENT, got ${sendResult.notificationStatus}`,
    );
    log('11.push.test_send_ok', sendResult);

    // 12. Inbox shows the new item, unread.
    const { data: inbox } = await api<{
      items: Array<{ id: string; readAt: string | null }>;
    }>(passenger.accessToken, 'GET', '/notifications/inbox');
    const inboxItem = inbox.items.find(
      (item) => item.id === sendResult.notificationId,
    );
    assert(inboxItem, 'Sent notification not found in the inbox');
    assert(
      inboxItem.readAt === null,
      'Freshly sent notification should be unread',
    );
    log('12.inbox.list_ok', { itemId: inboxItem.id });

    // 13. Opened + read, then confirm it drops out of the unread filter.
    await api(
      passenger.accessToken,
      'POST',
      `/notifications/inbox/${inboxItem.id}/opened`,
    );
    await api(
      passenger.accessToken,
      'POST',
      `/notifications/inbox/${inboxItem.id}/read`,
    );
    const { data: unread } = await api<{ items: unknown[] }>(
      passenger.accessToken,
      'GET',
      '/notifications/inbox?unreadOnly=true',
    );
    assert(
      !unread.items.some(
        (item) => (item as { id: string }).id === inboxItem.id,
      ),
      'Read notification should not appear in the unread-only inbox view',
    );
    log('13.inbox.opened_and_read_ok');

    // 14. Admin device-token debugging: list, then simulate an invalidation.
    const { data: adminDeviceList } = await api<Array<{ id: string }>>(
      superAdminToken,
      'GET',
      `/admin/staging/push/tokens/${passenger.userId}`,
    );
    assert(
      adminDeviceList.some((device) => device.id === passengerDevice.id),
      'Admin device-token viewer did not list the registered device',
    );
    await api(
      superAdminToken,
      'POST',
      `/admin/staging/push/tokens/${passengerDevice.id}/simulate-invalid`,
    );
    const { data: afterInvalidate } = await api<
      Array<{ id: string; status: string }>
    >(superAdminToken, 'GET', `/admin/staging/push/tokens/${passenger.userId}`);
    const invalidated = afterInvalidate.find(
      (device) => device.id === passengerDevice.id,
    );
    assert(
      invalidated?.status === 'INVALID',
      'simulate-invalid did not mark the token INVALID',
    );
    log('14.admin.token_debug_ok');

    // 15. Admin monitoring surface: push stats + dead-letter list/retry guard.
    const { data: stats } = await api<{
      outboxByStatus: Record<string, number>;
      activeTokens: unknown[];
    }>(superAdminToken, 'GET', '/admin/notifications/push-stats');
    assert(
      typeof stats.outboxByStatus === 'object',
      'push-stats response missing outboxByStatus',
    );
    const { status: deadLetterListStatus } = await api(
      superAdminToken,
      'GET',
      '/admin/notifications/dead-letter',
    );
    assert(deadLetterListStatus === 200, 'dead-letter list endpoint failed');
    const { status: retryStatus } = await api(
      superAdminToken,
      'POST',
      `/admin/notifications/dead-letter/${randomUUID()}/retry`,
    );
    assert(
      retryStatus === 404,
      `Expected 404 retrying a non-existent dead-letter event, got ${retryStatus}`,
    );
    log('15.admin.monitoring_ok', { outboxByStatus: stats.outboxByStatus });

    // Cleanup: revoke the device tokens this run created.
    await api(
      passenger.accessToken,
      'DELETE',
      `/notifications/devices/${passengerDevice.id}`,
    );
    await api(
      driver.accessToken,
      'DELETE',
      `/notifications/devices/${driverDevice.id}`,
    );
    log('cleanup.ok');

    log('push_smoke_test.passed');
  } finally {
    redis.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
