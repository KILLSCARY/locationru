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
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import type { TransportMode } from '../maps.types.js';

export class RoutePointDto {
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @Type(() => Number)
  @IsLongitude()
  longitude!: number;
}

export class RouteWaypointDto extends RoutePointDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24)
  sequence!: number;
}

export class RouteRequestDto {
  @ValidateNested()
  @Type(() => RoutePointDto)
  origin!: RoutePointDto;

  @ValidateNested()
  @Type(() => RoutePointDto)
  destination!: RoutePointDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RouteWaypointDto)
  waypoints?: RouteWaypointDto[];

  @IsOptional()
  @IsIn(['driving', 'walking'])
  transportMode?: TransportMode;

  @IsOptional()
  @IsBoolean()
  avoidTolls?: boolean;

  @IsOptional()
  @IsBoolean()
  avoidUnpavedRoads?: boolean;
}
