import {
  IsEnum,
  IsString,
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
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  deviceId!: string;

  @IsEnum(AuthDevicePlatform)
  platform!: AuthDevicePlatform;
}
