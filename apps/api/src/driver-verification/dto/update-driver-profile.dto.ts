import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * `phone` is deliberately not a field here — it always comes from the
 * authenticated session (User.phone), never from client input, see
 * DriverProfileService.
 */
export class UpdateDriverProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string;

  @IsDateString()
  birthDate!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  cityId!: string;
}
