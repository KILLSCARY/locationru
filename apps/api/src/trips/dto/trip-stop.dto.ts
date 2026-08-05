import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

import { TripAddressDto } from './trip-address.dto.js';

export class TripStopDto extends TripAddressDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  sequence!: number;
}
