import { IsUUID } from 'class-validator';

import { RequestCodeDto } from './request-code.dto.js';

export class ResendCodeDto extends RequestCodeDto {
  @IsUUID()
  requestId!: string;
}
