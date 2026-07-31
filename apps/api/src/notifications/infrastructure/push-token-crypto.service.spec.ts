import { randomBytes } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { PushTokenCryptoService } from './push-token-crypto.service.js';

function buildService(overrides?: {
  tokenEncryptionKey?: string;
  tokenHashSecret?: string;
}) {
  const config = new ConfigService({
    push: {
      tokenEncryptionKey:
        overrides?.tokenEncryptionKey ?? randomBytes(32).toString('base64'),
      tokenHashSecret: overrides?.tokenHashSecret ?? 'test-hash-secret',
    },
  });
  return new PushTokenCryptoService(config);
}

describe('PushTokenCryptoService', () => {
  it('round-trips encrypt/decrypt to the original raw token', () => {
    const service = buildService();
    const rawToken = 'fcm-token-abc123-very-long-device-push-token-value';

    const encrypted = service.encrypt(rawToken);

    expect(encrypted).not.toContain(rawToken);
    expect(service.decrypt(encrypted)).toBe(rawToken);
  });

  it('produces a different ciphertext each time (random IV) but decrypts to the same value', () => {
    const service = buildService();
    const rawToken = 'same-raw-token';

    const first = service.encrypt(rawToken);
    const second = service.encrypt(rawToken);

    expect(first).not.toBe(second);
    expect(service.decrypt(first)).toBe(rawToken);
    expect(service.decrypt(second)).toBe(rawToken);
  });

  it('hash is deterministic for the same input', () => {
    const service = buildService();
    const rawToken = 'fcm-token-abc123';

    expect(service.hash(rawToken)).toBe(service.hash(rawToken));
  });

  it('hash differs for different inputs and never contains the raw token', () => {
    const service = buildService();

    const hashA = service.hash('token-a');
    const hashB = service.hash('token-b');

    expect(hashA).not.toBe(hashB);
    expect(hashA).not.toContain('token-a');
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hash is not reversible into the original token via the crypto service itself', () => {
    const service = buildService();
    const rawToken = 'fcm-token-abc123';
    const hash = service.hash(rawToken);

    expect(() => service.decrypt(hash)).toThrow();
  });

  it('decrypt fails when the ciphertext has been tampered with', () => {
    const service = buildService();
    const encrypted = service.encrypt('fcm-token-abc123');
    const buffer = Buffer.from(encrypted, 'base64');
    buffer[buffer.length - 1] = (buffer[buffer.length - 1]! ^ 0xff) & 0xff;
    const tampered = buffer.toString('base64');

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('decrypt fails when using the wrong encryption key', () => {
    const serviceA = buildService();
    const serviceB = buildService();
    const encrypted = serviceA.encrypt('fcm-token-abc123');

    expect(() => serviceB.decrypt(encrypted)).toThrow();
  });

  it('throws at construction time when the encryption key does not decode to 32 bytes', () => {
    expect(() =>
      buildService({ tokenEncryptionKey: Buffer.from('too-short').toString('base64') }),
    ).toThrow('PUSH_TOKEN_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes');
  });
});
