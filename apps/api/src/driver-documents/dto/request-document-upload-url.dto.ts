import { IsIn, IsInt, IsString, Min, MinLength } from 'class-validator';

import { DriverDocumentType } from '../../generated/prisma/enums.js';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

export class RequestDriverDocumentUploadUrlDto {
  @IsIn(Object.values(DriverDocumentType))
  documentType!: DriverDocumentType;

  @IsString()
  @MinLength(1)
  fileName!: string;

  @IsIn(ALLOWED_MIME_TYPES)
  mimeType!: string;

  @IsInt()
  @Min(1)
  fileSize!: number;
}
