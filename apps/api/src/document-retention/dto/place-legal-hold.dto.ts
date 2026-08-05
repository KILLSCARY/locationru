import { IsString, MaxLength, MinLength } from 'class-validator';

export class PlaceLegalHoldDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reason!: string;
}
