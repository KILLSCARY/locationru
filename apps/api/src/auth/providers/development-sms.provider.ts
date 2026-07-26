import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { SmsProvider } from './sms-provider.interface.js';

@Injectable()
export class DevelopmentSmsProvider implements SmsProvider {
  private readonly environment: string;
  private readonly logger = new Logger(DevelopmentSmsProvider.name);

  constructor(configService: ConfigService) {
    this.environment = configService.getOrThrow<string>('app.environment');

    if (this.environment === 'production') {
      throw new Error('DevelopmentSmsProvider must not be used in production');
    }
  }

  async sendCode(phone: string, code: string): Promise<void> {
    if (this.environment === 'development') {
      this.logger.log({
        event: 'auth.development_otp',
        phone,
        code,
      });
    }

    await Promise.resolve();
  }
}
