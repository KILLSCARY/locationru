import { IsString, MaxLength, MinLength } from 'class-validator';

export class GeocodeRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1024)
  address!: string;
}
