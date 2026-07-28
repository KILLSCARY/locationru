import { createHmac } from 'node:crypto';

import { NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpPaymentProvider } from './http-payment.provider.js';

describe('HttpPaymentProvider', () => {
  const webhookSecret = 'test-webhook-secret-value';
  const provider = new HttpPaymentProvider(
    new ConfigService({
      payments: {
        apiBaseUrl: 'https://gateway.example/v1/',
        apiKey: 'test-key',
        webhookSecret,
        requestTimeoutMs: 10_000,
      },
    }),
  );

  const sign = (payload: string): string =>
    createHmac('sha256', webhookSecret).update(payload).digest('hex');

  it('is reported under its own provider name', () => {
    expect(provider.name).toBe('http');
  });

  it('accepts a webhook with a valid signature', () => {
    const payload = JSON.stringify({
      eventId: 'evt-1',
      paymentId: 'pay-1',
      type: 'payment.captured',
    });

    expect(
      provider.verifyWebhook({ payload, signature: sign(payload) }),
    ).toEqual({
      eventId: 'evt-1',
      paymentId: 'pay-1',
      type: 'payment.captured',
    });
  });

  it('rejects a webhook with a tampered signature', () => {
    const payload = JSON.stringify({ eventId: 'evt-2' });

    expect(() =>
      provider.verifyWebhook({ payload, signature: 'deadbeef' }),
    ).toThrow('Invalid payment webhook signature');
  });

  it('refuses money operations until a gateway is wired in', async () => {
    await expect(provider.createPayment()).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(provider.capturePayment()).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(provider.refundPayment()).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(provider.createDriverPayout()).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });
});
