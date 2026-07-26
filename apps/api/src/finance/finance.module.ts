import { Global, Module } from '@nestjs/common';

import { FareCalculator } from './fare-calculator.service.js';

@Global()
@Module({
  providers: [FareCalculator],
  exports: [FareCalculator],
})
export class FinanceModule {}
