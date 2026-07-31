import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { AppEnvironment } from '@resilient-taxi/config';
import { ConfigService } from '@nestjs/config';

import { PushProviderType } from '../../generated/prisma/enums.js';
import { RedisService } from '../../redis/redis.service.js';
import type {
  PushHealthCheckResult,
  PushProvider,
  SendToDeviceInput,
  SendToDevicesInput,
  SendToDevicesResult,
} from '../domain/push-provider.interface.js';

const STAGING_PUSH_LOOKUP_TTL_SECONDS = 3_600;

/** Redis key holding the last payload sent to a device, for the staging admin viewer — never the raw token. */
export function stagingPushLookupKey(devicePushTokenId: string): string {
  return `staging:push-lookup:${devicePushTokenId}`;
}

/**
 * Never sends a real push. Stores title/body/data (not the raw token) in a
 * short-lived Redis key so a SUPER_ADMIN can inspect the last payload a
 * staging device would have received, via the staging tools push viewer —
 * mirrors StagingSmsProvider's OTP-lookup pattern from the auth module.
 */
@Injectable()
export class StagingPushProvider implements PushProvider {
  readonly name = PushProviderType.STAGING;
  private readonly logger = new Logger(StagingPushProvider.name);

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    const environment = config.getOrThrow<AppEnvironment>('app.appEnvironment');
    if (environment === AppEnvironment.PRODUCTION) {
      throw new Error('StagingPushProvider must not be used in production');
    }
  }

  async sendToDevice(input: SendToDeviceInput) {
    return this.store(undefined, input);
  }

  async sendToDevices(input: SendToDevicesInput): Promise<SendToDevicesResult> {
    const results = await Promise.all(
      input.targets.map(async (target) => {
        const result = await this.store(target.devicePushTokenId, {
          rawToken: target.rawToken,
          platform: target.platform,
          title: input.title,
          body: input.body,
          data: input.data,
          priority: input.priority,
          ttlSeconds: input.ttlSeconds,
          ...(input.collapseKey ? { collapseKey: input.collapseKey } : {}),
        });
        return { ...result, devicePushTokenId: target.devicePushTokenId };
      }),
    );
    return { results };
  }

  validateToken(rawToken: string): boolean {
    return rawToken.length > 0;
  }

  async disableToken(): Promise<void> {
    await Promise.resolve();
  }

  async healthCheck(): Promise<PushHealthCheckResult> {
    await this.redis.checkConnection();
    return { healthy: true };
  }

  private async store(
    devicePushTokenId: string | undefined,
    input: SendToDeviceInput,
  ) {
    if (devicePushTokenId) {
      await this.redis.setWithTtl(
        stagingPushLookupKey(devicePushTokenId),
        JSON.stringify({
          title: input.title,
          body: input.body,
          data: input.data,
          priority: input.priority,
          sentAt: new Date().toISOString(),
        }),
        STAGING_PUSH_LOOKUP_TTL_SECONDS,
      );
    }
    this.logger.log({
      event: 'push.staging_send',
      title: input.title,
      priority: input.priority,
      // Deliberately no `body`/`data`/token — full payload is only readable
      // through the admin viewer endpoint, not the log stream.
    });
    return { status: 'ACCEPTED' as const, providerMessageId: randomUUID() };
  }
}
