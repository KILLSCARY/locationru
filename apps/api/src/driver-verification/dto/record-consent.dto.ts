import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { DriverConsentType } from '../../generated/prisma/client.js';

/** BIOMETRIC_PROCESSING_FUTURE is deliberately not accepted here — Task 29 section 23 excludes biometric processing at this stage. */
const ACCEPTABLE_CONSENT_TYPES = [
  DriverConsentType.PERSONAL_DATA_PROCESSING,
  DriverConsentType.DOCUMENT_PROCESSING,
  DriverConsentType.TERMS_OF_SERVICE,
  DriverConsentType.DRIVER_PARTNER_AGREEMENT,
] as const;

export class RecordConsentDto {
  @IsIn(ACCEPTABLE_CONSENT_TYPES)
  consentType!: (typeof ACCEPTABLE_CONSENT_TYPES)[number];

  /** Identifies which version of the consent text the driver accepted — see docs/drivers/verification.md. */
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  documentVersion!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceId?: string;
}
