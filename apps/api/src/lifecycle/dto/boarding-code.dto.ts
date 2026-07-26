import { IsString, Matches } from 'class-validator';

export class BoardingCodeDto {
  @IsString()
  @Matches(/^\d{4}$/)
  code!: string;
}
