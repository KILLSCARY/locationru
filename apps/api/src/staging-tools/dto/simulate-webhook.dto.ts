import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

const WEBHOOK_TYPES = [
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'payment.refunded',
] as const;

export class SimulateWebhookDto {
  @IsUUID()
  tripId!: string;

  @IsIn(WEBHOOK_TYPES)
  type!: (typeof WEBHOOK_TYPES)[number];

  /** Resends the same event id as the trip's last simulated webhook, to test idempotency. */
  @IsOptional()
  @IsBoolean()
  repeatLastEventId?: boolean;
}
