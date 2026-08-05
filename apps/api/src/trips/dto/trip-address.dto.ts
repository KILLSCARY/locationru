import { Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class TripAddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  formattedAddress!: string;

  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  providerPlaceId?: string | null;
}
