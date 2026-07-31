import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

import { PushProviderType } from '../../generated/prisma/enums.js';
import type {
  PushHealthCheckResult,
  PushProvider,
  SendToDeviceInput,
  SendToDevicesInput,
  SendToDevicesResult,
} from '../domain/push-provider.interface.js';

/** Never sends anything anywhere — logs the title/body/data so a developer can see what would have been pushed. Never logs the raw token. */
@Injectable()
export class DevelopmentPushProvider implements PushProvider {
  readonly name = PushProviderType.DEVELOPMENT;
  private readonly logger = new Logger(DevelopmentPushProvider.name);
  private readonly environment: AppEnvironment;

  constructor(config: ConfigService) {
    this.environment = config.getOrThrow<AppEnvironment>('app.appEnvironment');
  }

  async sendToDevice(input: SendToDeviceInput) {
    if (this.environment === AppEnvironment.DEVELOPMENT) {
      this.logger.log({
        event: 'push.development_send',
        title: input.title,
        body: input.body,
        data: input.data,
        priority: input.priority,
      });
    }
    await Promise.resolve();
    return { status: 'ACCEPTED' as const, providerMessageId: randomUUID() };
  }

  async sendToDevices(input: SendToDevicesInput): Promise<SendToDevicesResult> {
    const results = await Promise.all(
      input.targets.map(async (target) => {
        const result = await this.sendToDevice({
          rawToken: target.rawToken,
          platform: target.platform,
          title: input.title,
          body: input.body,
          data: input.data,
          priority: input.priority,
          ttlSeconds: input.ttlSeconds,
          category: input.category,
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
    await Promise.resolve();
    return { healthy: true };
  }
}
