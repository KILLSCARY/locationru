import { IsString, MaxLength, MinLength } from 'class-validator';

export class RequestCodeDto {
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  phone!: string;

  /** Used only for the per-device rate-limit axis (AuthRateLimitService) — never trusted as an identity claim. */
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  deviceId!: string;
}
