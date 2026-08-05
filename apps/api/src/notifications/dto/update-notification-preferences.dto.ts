import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';

import { NotificationCategory } from '../../generated/prisma/enums.js';

const NOTIFICATION_CATEGORIES = Object.values(NotificationCategory);

export class NotificationPreferenceEntryDto {
  @IsIn(NOTIFICATION_CATEGORIES)
  category!: NotificationCategory;

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  soundEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  vibrationEnabled?: boolean;
}

export class UpdateNotificationPreferencesDto {
  @IsArray()
  @ArrayMaxSize(NOTIFICATION_CATEGORIES.length)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceEntryDto)
  categories!: NotificationPreferenceEntryDto[];

  @IsOptional()
  @IsIn(['FULL', 'GENERIC', 'HIDDEN'])
  previewMode?: 'FULL' | 'GENERIC' | 'HIDDEN';
}
