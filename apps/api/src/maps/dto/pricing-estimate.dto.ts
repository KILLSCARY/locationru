import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min, ValidateNested } from 'class-validator';

import { RouteRequestDto } from './route-request.dto.js';

/**
 * A pricing estimate needs a distance and duration. The caller may pass them
 * directly (already computed from a route) or provide a route for the server to
 * estimate first.
 */
export class PricingEstimateRequestDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  distanceMeters?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => RouteRequestDto)
  route?: RouteRequestDto;
}
