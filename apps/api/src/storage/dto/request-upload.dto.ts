import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class RequestUploadDto {
  @IsString()
  @MinLength(1)
  mimeType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  // Accepted only for the audit trail (StoredDocument.originalFilename) —
  // never used to derive the storage object key. See DocumentsService.
  @IsOptional()
  @IsString()
  originalFilename?: string;
}
