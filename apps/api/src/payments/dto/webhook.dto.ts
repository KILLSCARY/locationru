import { IsString, MinLength } from 'class-validator';

export class WebhookDto {
  @IsString()
  @MinLength(1)
  payload!: string;

  @IsString()
  @MinLength(1)
  signature!: string;
}
