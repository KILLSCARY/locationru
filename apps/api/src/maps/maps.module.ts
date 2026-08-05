import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import {
  MapsController,
  PricingController,
  RoutesController,
} from './maps.controller.js';
import { MapsCacheService } from './maps-cache.service.js';
import { MapsRateLimitGuard } from './maps-rate-limit.guard.js';
import { MapsService } from './maps.service.js';
import { PricingEstimateService } from './pricing-estimate.service.js';
import { DevelopmentMapsProvider } from './providers/development-maps.provider.js';
import { YandexMapsProvider } from './providers/yandex-maps.provider.js';

@Module({
  imports: [AuthModule],
  controllers: [MapsController, RoutesController, PricingController],
  providers: [
    MapsCacheService,
    MapsRateLimitGuard,
    MapsService,
    PricingEstimateService,
    DevelopmentMapsProvider,
    YandexMapsProvider,
  ],
  exports: [MapsService, PricingEstimateService],
})
export class MapsModule {}
