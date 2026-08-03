import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MIN_PRODUCTION_YEAR = 1990;

/** Same fields as CreateVehicleDto, all optional — a partial update only touches the fields it sends. */
export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_PRODUCTION_YEAR)
  @Max(new Date().getFullYear() + 1)
  productionYear?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(32)
  vin?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  seats?: number;

  @IsOptional()
  @IsBoolean()
  childSeatAvailable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  luggageCapacity?: number;

  @IsOptional()
  @IsBoolean()
  petAllowed?: boolean;
}
