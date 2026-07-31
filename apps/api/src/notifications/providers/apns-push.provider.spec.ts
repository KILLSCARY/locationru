import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { ApnsPushProvider } from './apns-push.provider.js';
import { FirebasePushProvider } from './firebase-push.provider.js';

describe('ApnsPushProvider', () => {
  it('delegates sendToDevice to FirebasePushProvider (Variant B routing)', async () => {
    const send = jest.fn().mockResolvedValue('projects/x/messages/1');
    const firebase = new FirebasePushProvider(
      new ConfigService({ push: { fcm: {} } }),
      { messaging: { send } as never },
    );
    const provider = new ApnsPushProvider(firebase);

    const result = await provider.sendToDevice({
      rawToken: 'a'.repeat(64),
      platform: 'IOS' as never,
      title: 'Водитель прибыл',
      body: 'Машина ожидает в точке подачи.',
      data: {},
      priority: 'HIGH',
      ttlSeconds: 300,
    });

    expect(result).toEqual({
      status: 'ACCEPTED',
      providerMessageId: 'projects/x/messages/1',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports its own name as APNS, not FCM, for bookkeeping', () => {
    const firebase = new FirebasePushProvider(
      new ConfigService({ push: { fcm: {} } }),
    );
    const provider = new ApnsPushProvider(firebase);
    expect(provider.name).toBe('APNS');
  });
});
