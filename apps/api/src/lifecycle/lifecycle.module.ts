import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TripsModule } from '../trips/trips.module.js';
import { TestPaymentProvider } from './test-payment.provider.js';
import { TripLifecycleController } from './trip-lifecycle.controller.js';
import { TripLifecycleService } from './trip-lifecycle.service.js';

@Module({
  imports: [AuthModule, TripsModule, NotificationsModule],
  controllers: [TripLifecycleController],
  providers: [TripLifecycleService, TestPaymentProvider],
})
export class LifecycleModule {}
