import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateDriverBidDto {
  @IsUUID()
  vehicleId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  offeredPriceKopecks?: number;
}
