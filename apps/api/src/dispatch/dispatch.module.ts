import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DispatchService } from './dispatch.service.js';
import { createRouteEstimator } from './routing/route-estimator.factory.js';
import { ROUTE_ESTIMATOR } from './routing/route-estimator.interface.js';

@Module({
  providers: [
    DispatchService,
    {
      provide: ROUTE_ESTIMATOR,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createRouteEstimator(config),
    },
  ],
  exports: [DispatchService],
})
export class DispatchModule {}
