import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { TripAddressDto } from './trip-address.dto.js';
import { TripOptionsDto } from './trip-options.dto.js';
import { TripStopDto } from './trip-stop.dto.js';

export class CreateTripDto {
  @ValidateNested()
  @Type(() => TripAddressDto)
  pickup!: TripAddressDto;

  @ValidateNested()
  @Type(() => TripAddressDto)
  destination!: TripAddressDto;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  passengerPriceKopecks!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TripStopDto)
  waypoints?: TripStopDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TripOptionsDto)
  options?: TripOptionsDto;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
