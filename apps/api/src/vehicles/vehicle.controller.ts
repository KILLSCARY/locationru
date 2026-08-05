import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CreateVehicleDto } from './dto/create-vehicle.dto.js';
import { UpdateVehicleDto } from './dto/update-vehicle.dto.js';
import { VehicleService } from './vehicle.service.js';

@ApiTags('vehicles')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('DRIVER')
@Controller('drivers/me/vehicles')
export class VehicleController {
  constructor(private readonly vehicles: VehicleService) {}

  @Get()
  listVehicles(@CurrentUser() user: AuthenticatedUser) {
    return this.vehicles.listVehicles(user.id);
  }

  @Get(':vehicleId')
  getVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ) {
    return this.vehicles.getVehicle(user.id, vehicleId);
  }

  @Post()
  createVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateVehicleDto,
  ) {
    return this.vehicles.createVehicle(user.id, input);
  }

  @Put(':vehicleId')
  updateVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() input: UpdateVehicleDto,
  ) {
    return this.vehicles.updateVehicle(user.id, vehicleId, input);
  }

  @Post(':vehicleId/activate')
  setActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ) {
    return this.vehicles.setActive(user.id, vehicleId);
  }

  @Post(':vehicleId/deactivate')
  setInactive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ) {
    return this.vehicles.setInactive(user.id, vehicleId);
  }

  @Delete(':vehicleId')
  archiveVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ) {
    return this.vehicles.archiveVehicle(user.id, vehicleId);
  }
}
