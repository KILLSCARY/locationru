import { IsIn } from 'class-validator';

import type { StagingPaymentScenario } from '../../payments/staging-payment.provider.js';

const SCENARIOS: StagingPaymentScenario[] = [
  'SUCCESS',
  'DECLINED',
  'TIMEOUT',
  'DUPLICATE_WEBHOOK',
  'REFUND',
  'PAYOUT_FAILED',
];

export class SetPaymentScenarioDto {
  @IsIn(SCENARIOS)
  scenario!: StagingPaymentScenario;
}
