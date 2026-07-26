import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';

import { DriverLocationDto } from './driver-location.dto.js';

export class BatchDriverLocationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DriverLocationDto)
  locations!: DriverLocationDto[];
}
