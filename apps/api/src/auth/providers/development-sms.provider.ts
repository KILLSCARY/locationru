import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

import type { SmsProvider } from './sms-provider.interface.js';

@Injectable()
export class DevelopmentSmsProvider implements SmsProvider {
  private readonly environment: AppEnvironment;
  private readonly logger = new Logger(DevelopmentSmsProvider.name);

  constructor(configService: ConfigService) {
    this.environment =
      configService.getOrThrow<AppEnvironment>('app.appEnvironment');

    if (
      this.environment === AppEnvironment.STAGING ||
      this.environment === AppEnvironment.PRODUCTION
    ) {
      throw new Error(
        'DevelopmentSmsProvider must not be used in staging or production',
      );
    }
  }

  async sendCode(phone: string, code: string): Promise<void> {
    if (this.environment === AppEnvironment.DEVELOPMENT) {
      this.logger.log({
        event: 'auth.development_otp',
        phone,
        code,
      });
    }

    await Promise.resolve();
  }
}
