import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * `application` is deliberately not a field here — it is derived from the
 * authenticated user's role (see DeviceTokenController), so a passenger
 * account can never register a DRIVER-application token and vice versa.
 */
export class RegisterDeviceTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  deviceId!: string;

  @IsIn(['ANDROID', 'IOS'])
  platform!: 'ANDROID' | 'IOS';

  /** Never logged, never echoed back in any response — see PushTokenCryptoService. */
  @IsString()
  @MinLength(32)
  @MaxLength(4096)
  pushToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  osVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @IsBoolean()
  notificationsPermission!: boolean;
}
