import { IsString, MaxLength, MinLength } from 'class-validator';

export class RequestCodeDto {
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  phone!: string;
}
