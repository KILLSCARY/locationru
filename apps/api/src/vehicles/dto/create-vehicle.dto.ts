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

export class CreateVehicleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  brand!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  model!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  color!: string;

  @IsInt()
  @Min(MIN_PRODUCTION_YEAR)
  @Max(new Date().getFullYear() + 1)
  productionYear!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  registrationNumber!: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(32)
  vin?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  category!: string;

  @IsInt()
  @Min(1)
  @Max(9)
  seats!: number;

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
