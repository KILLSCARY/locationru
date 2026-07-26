import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { DriverLocationConfidence } from '../../generated/prisma/client.js';

export class DriverLocationDto {
  @Type(() => Date)
  @IsDate()
  recordedAt!: Date;

  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100_000)
  accuracyMeters!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(200)
  speedMetersPerSecond?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(359.999_999)
  bearingDegrees?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-15_000)
  @Max(100_000)
  altitudeMeters?: number | null;

  @IsString()
  @MaxLength(64)
  provider!: string;

  @IsEnum(DriverLocationConfidence)
  confidence!: DriverLocationConfidence;

  @IsBoolean()
  suspectedSpoofing!: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1_000)
  satellitesVisible?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1_000)
  cellCount?: number | null;
}
