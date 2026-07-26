import { Type } from 'class-transformer';
import { IsString, MaxLength, ValidateNested } from 'class-validator';

import { CoordinatesDto } from './coordinates.dto.js';

export class TripStopDto {
  @ValidateNested()
  @Type(() => CoordinatesDto)
  location!: CoordinatesDto;

  @IsString()
  @MaxLength(512)
  address!: string;
}
