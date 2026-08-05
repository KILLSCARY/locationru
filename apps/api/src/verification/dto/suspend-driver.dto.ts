import { IsString, MaxLength, MinLength } from 'class-validator';

export class SuspendDriverDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  comment!: string;
}
