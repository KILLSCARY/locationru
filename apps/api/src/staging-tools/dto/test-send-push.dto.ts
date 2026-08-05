import { IsIn, IsUUID } from 'class-validator';

export class TestSendPushDto {
  @IsUUID()
  userId!: string;

  @IsIn(['PASSENGER', 'DRIVER'])
  application!: 'PASSENGER' | 'DRIVER';
}
