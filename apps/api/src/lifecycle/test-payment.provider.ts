import { randomUUID } from 'node:crypto';

import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PaymentProvider {
  capture(reference: string): Promise<void>;
  reserve(amountKopecks: number): Promise<{ reference: string }>;
}

@Injectable()
export class TestPaymentProvider implements PaymentProvider, OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (this.config.getOrThrow<string>('app.environment') === 'production') {
      throw new Error('TestPaymentProvider must not run in production');
    }
  }

  async reserve(amountKopecks: number): Promise<{ reference: string }> {
    void amountKopecks;
    return { reference: `test-reservation-${randomUUID()}` };
  }

  async capture(reference: string): Promise<void> {
    void reference;
    // A deterministic in-process provider is intentionally used until a real PSP is integrated.
  }
}
