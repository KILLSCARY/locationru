import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { MapsModule } from '../maps/maps.module.js';
import { TripController } from './trip.controller.js';
import { TripService } from './trip.service.js';
import { TripStateMachine } from './trip-state-machine.service.js';

@Module({
  imports: [AuthModule, RealtimeModule, MapsModule],
  controllers: [TripController],
  providers: [TripStateMachine, TripService],
  exports: [TripStateMachine, TripService],
})
export class TripsModule {}
