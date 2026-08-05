import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class GeoPointDto {
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @Type(() => Number)
  @IsLongitude()
  longitude!: number;
}

export class AddressSuggestionsQueryDto {
  @IsString()
  @MinLength(3)
  @MaxLength(256)
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit = 5;
}

export class GeocodeAddressDto {
  @IsString()
  @MinLength(3)
  @MaxLength(512)
  address!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  providerPlaceId?: string | null;
}

export class RouteRequestDto {
  @ValidateNested()
  @Type(() => GeoPointDto)
  origin!: GeoPointDto;

  @ValidateNested()
  @Type(() => GeoPointDto)
  destination!: GeoPointDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GeoPointDto)
  waypoints: GeoPointDto[] = [];

  @IsOptional()
  @IsIn(['CAR'])
  transportMode = 'CAR' as const;

  @IsOptional()
  @IsBoolean()
  avoidTolls = false;

  @IsOptional()
  @IsBoolean()
  avoidUnpavedRoads = false;
}
