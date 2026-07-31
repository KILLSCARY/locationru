import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { DevelopmentPushProvider } from './development-push.provider.js';

describe('DevelopmentPushProvider', () => {
  it('never logs the raw token and accepts every send', async () => {
    const config = new ConfigService({
      app: { appEnvironment: 'development' },
    });
    const provider = new DevelopmentPushProvider(config);
    const logSpy = jest.spyOn(
      (provider as unknown as { logger: { log: (...args: unknown[]) => void } })
        .logger,
      'log',
    );

    const result = await provider.sendToDevice({
      rawToken: 'super-secret-raw-token',
      platform: 'ANDROID' as never,
      title: 'Новый заказ рядом',
      body: 'Пассажир предложил 350 ₽',
      data: { tripId: 'trip-1' },
      priority: 'HIGH',
      ttlSeconds: 30,
    });

    expect(result.status).toBe('ACCEPTED');
    for (const call of logSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('super-secret-raw-token');
    }
  });

  it('fans sendToDevices out to one result per target, preserving order', async () => {
    const config = new ConfigService({ app: { appEnvironment: 'test' } });
    const provider = new DevelopmentPushProvider(config);

    const result = await provider.sendToDevices({
      targets: [
        {
          devicePushTokenId: 'a',
          rawToken: 'token-a',
          platform: 'ANDROID' as never,
        },
        {
          devicePushTokenId: 'b',
          rawToken: 'token-b',
          platform: 'IOS' as never,
        },
      ],
      title: 't',
      body: 'b',
      data: {},
      priority: 'NORMAL',
      ttlSeconds: 300,
    });

    expect(result.results.map((entry) => entry.devicePushTokenId)).toEqual([
      'a',
      'b',
    ]);
    expect(result.results.every((entry) => entry.status === 'ACCEPTED')).toBe(
      true,
    );
  });

  it('healthCheck always reports healthy', async () => {
    const provider = new DevelopmentPushProvider(
      new ConfigService({ app: { appEnvironment: 'development' } }),
    );
    await expect(provider.healthCheck()).resolves.toEqual({ healthy: true });
  });
});
