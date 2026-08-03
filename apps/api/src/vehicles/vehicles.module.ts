import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DriversModule } from '../drivers/drivers.module.js';
import { VehicleController } from './vehicle.controller.js';
import { VehicleService } from './vehicle.service.js';

@Module({
  imports: [AuthModule, DriversModule],
  controllers: [VehicleController],
  providers: [VehicleService],
  exports: [VehicleService],
})
export class VehiclesModule {}
