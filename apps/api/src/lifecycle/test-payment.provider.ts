import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

export interface PaymentProvider {
  capture(reference: string): Promise<void>;
  reserve(amountKopecks: number): Promise<{ reference: string }>;
}

@Injectable()
export class TestPaymentProvider implements PaymentProvider {
  async reserve(amountKopecks: number): Promise<{ reference: string }> {
    void amountKopecks;
    return { reference: `test-reservation-${randomUUID()}` };
  }

  async capture(reference: string): Promise<void> {
    void reference;
    // A deterministic in-process provider is intentionally used until a real PSP is integrated.
  }
}
