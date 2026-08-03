import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { AdminModule } from './admin/admin.module.js';
import { BidsModule } from './bids/bids.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DispatchModule } from './dispatch/dispatch.module.js';
import { DriverDocumentsModule } from './driver-documents/driver-documents.module.js';
import { DriversModule } from './drivers/drivers.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { HealthModule } from './health/health.module.js';
import { LifecycleModule } from './lifecycle/lifecycle.module.js';
import { MapsModule } from './maps/maps.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { RedisModule } from './redis/redis.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { StagingToolsModule } from './staging-tools/staging-tools.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TripsModule } from './trips/trips.module.js';
import { SmsWebhookModule } from './webhooks/sms-webhook.module.js';

@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    DatabaseModule,
    RedisModule,
    RealtimeModule,
    HealthModule,
    AuthModule,
    AdminModule,
    BidsModule,
    TripsModule,
    DriversModule,
    DriverDocumentsModule,
    DispatchModule,
    FinanceModule,
    LifecycleModule,
    PaymentsModule,
    MapsModule,
    StorageModule,
    StagingToolsModule,
    SmsWebhookModule,
    NotificationsModule,
  ],
})
export class AppModule {}
