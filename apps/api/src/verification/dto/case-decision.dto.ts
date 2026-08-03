import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { DocumentRejectionReasonCode } from '../../generated/prisma/client.js';

/** Used for case-wide reject-driver/request-changes decisions, which may combine several reasons across documents/vehicle/profile. */
export class CaseDecisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(DocumentRejectionReasonCode, { each: true })
  reasonCodes!: DocumentRejectionReasonCode[];

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  comment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  internalComment?: string;
}
