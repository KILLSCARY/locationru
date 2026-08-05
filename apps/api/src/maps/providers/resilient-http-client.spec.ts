import { jest } from '@jest/globals';

import { MapsProviderError } from './maps-provider.errors.js';
import { ResilientHttpClient } from './resilient-http-client.js';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('ResilientHttpClient', () => {
  it('returns parsed JSON on success', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    const client = new ResilientHttpClient({
      provider: 'test',
      timeoutMs: 1_000,
      maxRetries: 2,
      userAgent: 'test-agent',
      fetchImpl,
      sleep: async () => {},
    });

    await expect(client.getJson('https://example.test/a')).resolves.toEqual({
      ok: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a GET on a 429 and eventually succeeds', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new ResilientHttpClient({
      provider: 'test',
      timeoutMs: 1_000,
      maxRetries: 2,
      userAgent: 'test-agent',
      fetchImpl,
      sleep: async () => {},
    });

    const result = await client.getJson('https://example.test/a');
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('normalizes a rate-limit failure that exhausts retries', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(429, {}));
    const client = new ResilientHttpClient({
      provider: 'test',
      timeoutMs: 1_000,
      maxRetries: 1,
      userAgent: 'test-agent',
      fetchImpl,
      sleep: async () => {},
    });

    const error = await client
      .getJson('https://example.test/a')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MapsProviderError);
    expect((error as MapsProviderError).kind).toBe('rate_limited');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable 4xx response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(400, {}));
    const client = new ResilientHttpClient({
      provider: 'test',
      timeoutMs: 1_000,
      maxRetries: 3,
      userAgent: 'test-agent',
      fetchImpl,
      sleep: async () => {},
    });

    const error = await client
      .getJson('https://example.test/a')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MapsProviderError);
    expect((error as MapsProviderError).kind).toBe('invalid_response');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never retries a POST even when the response is retryable', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(503, {}));
    const client = new ResilientHttpClient({
      provider: 'test',
      timeoutMs: 1_000,
      maxRetries: 3,
      userAgent: 'test-agent',
      fetchImpl,
      sleep: async () => {},
    });

    await expect(
      client.postJson('https://example.test/a', { x: 1 }),
    ).rejects.toBeInstanceOf(MapsProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('normalizes an aborted request as a timeout', async () => {
    const fetchImpl = jest.fn().mockImplementation(() => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });
    const client = new ResilientHttpClient({
      provider: 'test',
      timeoutMs: 1_000,
      maxRetries: 0,
      userAgent: 'test-agent',
      fetchImpl,
      sleep: async () => {},
    });

    const error = await client
      .getJson('https://example.test/a')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MapsProviderError);
    expect((error as MapsProviderError).kind).toBe('timeout');
  });
});
