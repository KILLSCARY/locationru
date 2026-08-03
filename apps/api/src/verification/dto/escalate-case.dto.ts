import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EscalateCaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  comment?: string;
}
