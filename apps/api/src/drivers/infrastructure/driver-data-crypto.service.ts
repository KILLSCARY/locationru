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
 * The only place a raw vehicle registration number/VIN or driver document
 * number is encrypted/decrypted/hashed. Same shape as
 * notifications/infrastructure/push-token-crypto.service.ts, deliberately
 * with its own key material (DRIVER_DATA_ENCRYPTION_KEY/
 * DRIVER_DATA_HASH_SECRET) — a different security boundary than push
 * tokens. `encrypt`/`decrypt` are reversible (a real value is needed to
 * show a masked version or to compare during a manual review); `hash` is
 * one-way and is what uniqueness/duplicate-detection lookups use instead of
 * the (randomly-IV'd, therefore non-comparable) ciphertext.
 */
@Injectable()
export class DriverDataCryptoService {
  private readonly encryptionKey: Buffer;
  private readonly hashSecret: string;

  constructor(config: ConfigService) {
    const encoded = config.getOrThrow<string>(
      'driverVerification.dataEncryptionKey',
    );
    this.encryptionKey = Buffer.from(encoded, 'base64');
    if (this.encryptionKey.length !== 32) {
      throw new Error(
        'DRIVER_DATA_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes',
      );
    }
    this.hashSecret = config.getOrThrow<string>(
      'driverVerification.dataHashSecret',
    );
  }

  encrypt(rawValue: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(rawValue, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(encryptedValue: string): string {
    const data = Buffer.from(encryptedValue, 'base64');
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

  hash(rawValue: string): string {
    return createHmac('sha256', this.hashSecret)
      .update(this.normalize(rawValue))
      .digest('hex');
  }

  /** Normalizes before hashing so equivalent values (whitespace/case) always duplicate-match — see docs/drivers/eligibility.md. */
  private normalize(rawValue: string): string {
    return rawValue.trim().toUpperCase().replace(/\s+/g, '');
  }
}
