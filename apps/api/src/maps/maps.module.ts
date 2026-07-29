import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module.js';
import { MapsCacheService } from './cache/maps-cache.service.js';
import { MapsController } from './maps.controller.js';
import { MapsRateLimitService } from './maps-rate-limit.service.js';
import { MapsService } from './maps.service.js';
import { PricingController } from './pricing.controller.js';
import { PricingEstimateService } from './pricing/pricing-estimate.service.js';
import { createMapsProvider } from './providers/maps-provider.factory.js';
import { MAPS_PROVIDER } from './providers/maps-provider.interface.js';
import { RoutesController } from './routes.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [MapsController, RoutesController, PricingController],
  providers: [
    {
      provide: MAPS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createMapsProvider(config),
    },
    MapsCacheService,
    MapsRateLimitService,
    MapsService,
    PricingEstimateService,
  ],
  exports: [MapsService, PricingEstimateService],
})
export class MapsModule {}
