import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { SmsRuProvider } from './sms-ru.provider.js';

function config(overrides: Partial<{ apiId: string; senderId: string }> = {}) {
  return new ConfigService({
    sms: {
      senderId: overrides.senderId ?? '',
      smsRu: {
        apiId: overrides.apiId ?? 'test-api-id',
        apiBaseUrl: 'https://sms.ru',
        timeoutMs: 5_000,
        maxRetries: 2,
        circuitFailureThreshold: 5,
        circuitOpenMs: 30_000,
      },
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SmsRuProvider', () => {
  it('sends a verification code and never puts the api_id in the returned result', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: 'OK',
        status_code: 100,
        sms: {
          '+79995551234': { status: 'OK', status_code: 101, sms_id: 'msg-1' },
        },
      }),
    );
    const provider = new SmsRuProvider(config(), { fetchImpl });

    const result = await provider.sendVerificationCode({
      phone: '+79995551234',
      code: '123456',
      message: 'Код входа в Resilient Taxi: 123456. Никому его не сообщайте.',
      channel: 'SMS' as never,
      requestId: 'req-1',
    });

    expect(result).toEqual({ providerMessageId: 'msg-1', status: 'SENT' });
    const calledUrl = String(fetchImpl.mock.calls[0]![0]);
    expect(calledUrl).toContain('api_id=test-api-id');
    expect(JSON.stringify(result)).not.toContain('test-api-id');
  });

  it('never retries a send, even on a 500', async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('boom', { status: 500 }));
    const provider = new SmsRuProvider(config(), {
      fetchImpl,
      sleep: async () => undefined,
    });

    await expect(
      provider.sendVerificationCode({
        phone: '+79995551234',
        code: '123456',
        message: 'msg',
        channel: 'SMS' as never,
        requestId: 'req-1',
      }),
    ).rejects.toThrow('SMS.RU is unavailable');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries the (idempotent) status check up to maxRetries on a 500', async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'OK',
          status_code: 100,
          sms: { 'msg-1': { status: 'OK', status_code: 102 } },
        }),
      );
    const provider = new SmsRuProvider(config(), {
      fetchImpl,
      sleep: async () => undefined,
    });

    const result = await provider.getDeliveryStatus('msg-1');
    expect(result.status).toBe('DELIVERED');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('normalizes a rejected send without leaking status_text verbatim as the api key', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: 'ERROR',
        status_code: 202,
        status_text: 'bad number',
      }),
    );
    const provider = new SmsRuProvider(config(), { fetchImpl });

    await expect(
      provider.sendVerificationCode({
        phone: '+70000000000',
        code: '123456',
        message: 'msg',
        channel: 'SMS' as never,
        requestId: 'req-1',
      }),
    ).rejects.toThrow('SMS.RU rejected the request');
  });

  it('healthCheck reflects balance-endpoint reachability without exposing the balance', async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ status: 'OK', status_code: 100, balance: 123.45 }),
      );
    const provider = new SmsRuProvider(config(), { fetchImpl });

    const result = await provider.healthCheck();
    expect(result).toEqual({ healthy: true });
  });

  it('getBalance returns the numeric balance for admin use', async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ status: 'OK', status_code: 100, balance: 123.45 }),
      );
    const provider = new SmsRuProvider(config(), { fetchImpl });

    await expect(provider.getBalance()).resolves.toEqual({
      balanceRub: 123.45,
    });
  });

  it('handleStatusWebhook parses a form-encoded body and computes a stable hash', async () => {
    const provider = new SmsRuProvider(config(), {
      fetchImpl: jest.fn() as never,
    });
    const rawBody = 'sms_id=msg-1&status=DELIVERED&status_code=102';

    const event = await provider.handleStatusWebhook(rawBody, {
      'content-type': 'application/x-www-form-urlencoded',
    });

    expect(event.providerMessageId).toBe('msg-1');
    expect(event.status).toBe('DELIVERED');
    expect(event.rawEventHash).toHaveLength(64);

    const event2 = await provider.handleStatusWebhook(rawBody, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(event2.rawEventHash).toBe(event.rawEventHash);
  });

  it('opens the circuit after repeated failures and short-circuits further sends', async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('boom', { status: 500 }));
    const provider = new SmsRuProvider(
      new ConfigService({
        sms: {
          senderId: '',
          smsRu: {
            apiId: 'test-api-id',
            apiBaseUrl: 'https://sms.ru',
            timeoutMs: 5_000,
            maxRetries: 0,
            circuitFailureThreshold: 2,
            circuitOpenMs: 30_000,
          },
        },
      }),
      { fetchImpl, sleep: async () => undefined },
    );

    for (let i = 0; i < 2; i += 1) {
      await expect(
        provider.sendVerificationCode({
          phone: '+79995551234',
          code: '123456',
          message: 'msg',
          channel: 'SMS' as never,
          requestId: 'req-1',
        }),
      ).rejects.toThrow();
    }

    await expect(
      provider.sendVerificationCode({
        phone: '+79995551234',
        code: '123456',
        message: 'msg',
        channel: 'SMS' as never,
        requestId: 'req-1',
      }),
    ).rejects.toThrow('SMS.RU circuit is open');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
