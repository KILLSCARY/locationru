import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { FirebasePushProvider } from './firebase-push.provider.js';

function config() {
  return new ConfigService({
    push: {
      fcm: {
        projectId: 'test-project',
        clientEmail: 'test@test-project.iam.gserviceaccount.com',
        privateKey: 'unused-in-tests',
      },
    },
  });
}

describe('FirebasePushProvider', () => {
  it('sends a single message and returns the provider message id', async () => {
    const send = jest.fn<() => Promise<string>>().mockResolvedValue('projects/x/messages/1');
    const provider = new FirebasePushProvider(config(), {
      messaging: { send } as never,
    });

    const result = await provider.sendToDevice({
      rawToken: 'a'.repeat(64),
      platform: 'ANDROID' as never,
      title: 'Новый заказ рядом',
      body: 'Пассажир предложил 350 ₽',
      data: { tripId: 'trip-1' },
      priority: 'HIGH',
      ttlSeconds: 30,
    });

    expect(result).toEqual({
      status: 'ACCEPTED',
      providerMessageId: 'projects/x/messages/1',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('classifies an invalid-registration-token error as TOKEN_INVALID', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('bad token'), {
          code: 'messaging/registration-token-not-registered',
        }),
      );
    const provider = new FirebasePushProvider(config(), {
      messaging: { send } as never,
    });

    const result = await provider.sendToDevice({
      rawToken: 'a'.repeat(64),
      platform: 'ANDROID' as never,
      title: 't',
      body: 'b',
      data: {},
      priority: 'NORMAL',
      ttlSeconds: 30,
    });

    expect(result.status).toBe('TOKEN_INVALID');
  });

  it('classifies an unrecognized error as FAILED_TEMPORARY (retryable by default)', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('boom'), { code: 'messaging/internal-error' }));
    const provider = new FirebasePushProvider(config(), {
      messaging: { send } as never,
    });

    const result = await provider.sendToDevice({
      rawToken: 'a'.repeat(64),
      platform: 'ANDROID' as never,
      title: 't',
      body: 'b',
      data: {},
      priority: 'NORMAL',
      ttlSeconds: 30,
    });

    expect(result.status).toBe('FAILED_TEMPORARY');
  });

  it('sendToDevices maps per-target success/failure from a multicast response, preserving order', async () => {
    const sendEachForMulticast = jest.fn().mockResolvedValue({
      responses: [
        { success: true, messageId: 'msg-1' },
        { success: false, error: { code: 'messaging/invalid-registration-token' } },
      ],
      successCount: 1,
      failureCount: 1,
    });
    const provider = new FirebasePushProvider(config(), {
      messaging: { sendEachForMulticast } as never,
    });

    const result = await provider.sendToDevices({
      targets: [
        { devicePushTokenId: 'a', rawToken: 'a'.repeat(64), platform: 'ANDROID' as never },
        { devicePushTokenId: 'b', rawToken: 'b'.repeat(64), platform: 'ANDROID' as never },
      ],
      title: 't',
      body: 'b',
      data: {},
      priority: 'HIGH',
      ttlSeconds: 30,
    });

    expect(result.results).toEqual([
      { devicePushTokenId: 'a', status: 'ACCEPTED', providerMessageId: 'msg-1' },
      {
        devicePushTokenId: 'b',
        status: 'TOKEN_INVALID',
        errorCode: 'messaging/invalid-registration-token',
      },
    ]);
  });

  it('chunks a batch larger than 500 targets into multiple multicast calls', async () => {
    const sendEachForMulticast = jest.fn().mockImplementation(async (message: unknown) => {
      const tokens = (message as { tokens: string[] }).tokens;
      return {
        responses: tokens.map(() => ({ success: true, messageId: 'msg' })),
        successCount: tokens.length,
        failureCount: 0,
      };
    });
    const provider = new FirebasePushProvider(config(), {
      messaging: { sendEachForMulticast } as never,
    });

    const targets = Array.from({ length: 750 }, (_, index) => ({
      devicePushTokenId: `device-${index}`,
      rawToken: `token-${index}`.padEnd(64, '0'),
      platform: 'ANDROID' as never,
    }));

    const result = await provider.sendToDevices({
      targets,
      title: 't',
      body: 'b',
      data: {},
      priority: 'NORMAL',
      ttlSeconds: 30,
    });

    expect(sendEachForMulticast).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(750);
  });

  it('validateToken rejects obviously malformed tokens without a network call', () => {
    const provider = new FirebasePushProvider(config());
    expect(provider.validateToken('a'.repeat(64))).toBe(true);
    expect(provider.validateToken('short')).toBe(false);
    expect(provider.validateToken('has whitespace'.padEnd(64, 'x'))).toBe(false);
  });

  it('healthCheck succeeds without a network call when credentials parse', async () => {
    const provider = new FirebasePushProvider(config(), {
      messaging: {} as never,
    });
    await expect(provider.healthCheck()).resolves.toEqual({ healthy: true });
  });

  it('never includes the raw token in a classified error result', async () => {
    const rawToken = 'super-secret-device-token-that-must-never-leak';
    const send = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error(rawToken), { code: 'messaging/internal-error' }));
    const provider = new FirebasePushProvider(config(), {
      messaging: { send } as never,
    });

    const result = await provider.sendToDevice({
      rawToken,
      platform: 'ANDROID' as never,
      title: 't',
      body: 'b',
      data: {},
      priority: 'NORMAL',
      ttlSeconds: 30,
    });

    expect(JSON.stringify(result)).not.toContain(rawToken);
  });
});
