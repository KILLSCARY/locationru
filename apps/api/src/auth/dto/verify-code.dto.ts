import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { RequestCodeDto } from './request-code.dto.js';

export enum AuthDevicePlatform {
  IOS = 'IOS',
  ANDROID = 'ANDROID',
  WEB = 'WEB',
}

export class VerifyCodeDto extends RequestCodeDto {
  @IsUUID()
  requestId!: string;

  @IsString()
  @Matches(/^\d{4,10}$/)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  deviceId!: string;

  @IsEnum(AuthDevicePlatform)
  platform!: AuthDevicePlatform;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;
}
