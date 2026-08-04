import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MapsModule } from '../maps/maps.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { TripController } from './trip.controller.js';
import { TripService } from './trip.service.js';
import { TripStateMachine } from './trip-state-machine.service.js';

@Module({
  imports: [
    AuthModule,
    RealtimeModule,
    MapsModule,
    NotificationsModule,
    StorageModule,
  ],
  controllers: [TripController],
  providers: [TripStateMachine, TripService],
  exports: [TripStateMachine, TripService],
})
export class TripsModule {}
