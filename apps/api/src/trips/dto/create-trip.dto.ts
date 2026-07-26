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

import { CoordinatesDto } from './coordinates.dto.js';
import { TripOptionsDto } from './trip-options.dto.js';
import { TripStopDto } from './trip-stop.dto.js';

export class CreateTripDto {
  @ValidateNested()
  @Type(() => CoordinatesDto)
  pickup!: CoordinatesDto;

  @ValidateNested()
  @Type(() => CoordinatesDto)
  destination!: CoordinatesDto;

  @IsString()
  @MaxLength(512)
  pickupAddress!: string;

  @IsString()
  @MaxLength(512)
  destinationAddress!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  passengerPriceKopecks!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TripStopDto)
  stops?: TripStopDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TripOptionsDto)
  options?: TripOptionsDto;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
