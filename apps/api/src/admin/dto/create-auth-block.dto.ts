import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Exactly one of phone/deviceId identifies the subject to block. `phone` is
 * normalized and hashed server-side (AdminAuthService never stores or logs
 * the raw number) — the same phoneHash OtpService itself keys on.
 */
export class CreateAuthBlockDto {
  @ValidateIf((dto: CreateAuthBlockDto) => !dto.deviceId)
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  phone?: string;

  @ValidateIf((dto: CreateAuthBlockDto) => !dto.phone)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  deviceId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reason!: string;

  /** Omit for an indefinite block — only a human admin action (this endpoint) may do that; every automatic block OtpService creates always carries an expiry. */
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(31_536_000)
  expiresInSeconds?: number;
}
