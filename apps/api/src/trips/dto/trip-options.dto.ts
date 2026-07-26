import { IsBoolean, IsOptional } from 'class-validator';

export class TripOptionsDto {
  @IsOptional()
  @IsBoolean()
  childSeat?: boolean;

  @IsOptional()
  @IsBoolean()
  pet?: boolean;

  @IsOptional()
  @IsBoolean()
  luggage?: boolean;
}
