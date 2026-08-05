import { createHmac } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { DriverConsentType } from '../generated/prisma/client.js';
import type { RecordConsentDto } from './dto/record-consent.dto.js';

/** Every type except BIOMETRIC_PROCESSING_FUTURE (reserved, unused — Task 29 section 23) must be accepted before a driver can submit for verification. */
export const REQUIRED_CONSENT_TYPES = [
  DriverConsentType.PERSONAL_DATA_PROCESSING,
  DriverConsentType.DOCUMENT_PROCESSING,
  DriverConsentType.TERMS_OF_SERVICE,
  DriverConsentType.DRIVER_PARTNER_AGREEMENT,
] as const;

@Injectable()
export class DriverConsentService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async recordConsent(
    userId: string,
    input: RecordConsentDto,
    context: { ip?: string },
  ) {
    return this.prisma.driverConsent.create({
      data: {
        userId,
        consentType: input.consentType,
        documentVersion: input.documentVersion,
        deviceId: input.deviceId ?? null,
        ipHash: context.ip ? this.hashIp(context.ip) : null,
      },
    });
  }

  async listMyConsents(userId: string) {
    return this.prisma.driverConsent.findMany({
      where: { userId },
      orderBy: { acceptedAt: 'desc' },
      select: {
        id: true,
        consentType: true,
        documentVersion: true,
        acceptedAt: true,
        revokedAt: true,
      },
    });
  }

  /** The still-active (non-revoked) consent types on file — the set the submission workflow checks against REQUIRED_CONSENT_TYPES. */
  async getActiveConsentTypes(userId: string): Promise<Set<DriverConsentType>> {
    const rows = await this.prisma.driverConsent.findMany({
      where: { userId, revokedAt: null },
      select: { consentType: true },
    });
    return new Set(rows.map((row) => row.consentType));
  }

  private hashIp(ip: string): string {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('auth.otpHashSecret'),
    )
      .update(ip)
      .digest('hex');
  }
}
