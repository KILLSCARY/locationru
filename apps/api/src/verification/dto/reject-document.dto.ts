import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { DocumentRejectionReasonCode } from '../../generated/prisma/client.js';

export class RejectDocumentDto {
  @IsEnum(DocumentRejectionReasonCode)
  reasonCode!: DocumentRejectionReasonCode;

  /** Shown to the driver — see docs/drivers/verification.md for the public/internal split. */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  comment?: string;

  /** Admin-only, never shown to the driver — recorded on the audit log entry, not on the document row. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  internalComment?: string;
}
