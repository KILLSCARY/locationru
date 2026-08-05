import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * The only place a raw push token is encrypted/decrypted/hashed. Encryption
 * is reversible (AES-256-GCM, key from PUSH_TOKEN_ENCRYPTION_KEY) because
 * sending a push later requires the real token; `hash` (HMAC-SHA256, a
 * separate secret) is one-way and is what DevicePushToken.tokenHash uses
 * for uniqueness/lookup — the raw token itself is never used as a database
 * key and never appears in a log line anywhere in this module.
 */
@Injectable()
export class PushTokenCryptoService {
  private readonly encryptionKey: Buffer;
  private readonly hashSecret: string;

  constructor(config: ConfigService) {
    const encoded = config.getOrThrow<string>('push.tokenEncryptionKey');
    this.encryptionKey = Buffer.from(encoded, 'base64');
    if (this.encryptionKey.length !== 32) {
      throw new Error(
        'PUSH_TOKEN_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes',
      );
    }
    this.hashSecret = config.getOrThrow<string>('push.tokenHashSecret');
  }

  encrypt(rawToken: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(rawToken, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(encryptedToken: string): string {
    const data = Buffer.from(encryptedToken, 'base64');
    const iv = data.subarray(0, IV_BYTES);
    const authTag = data.subarray(IV_BYTES, IV_BYTES + 16);
    const ciphertext = data.subarray(IV_BYTES + 16);
    const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  hash(rawToken: string): string {
    return createHmac('sha256', this.hashSecret).update(rawToken).digest('hex');
  }
}
