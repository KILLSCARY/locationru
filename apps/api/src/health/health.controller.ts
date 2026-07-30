import {
  Controller,
  Get,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import {
  HealthService,
  type DetailedStatusResponse,
  type HealthResponse,
  type ReadinessResponse,
} from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Check whether the API process is alive' })
  @ApiOkResponse({ description: 'The API process is running' })
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe: the process is alive, no dependency checks' })
  @ApiOkResponse({ description: 'The API process is running' })
  getLiveness(): HealthResponse {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @ApiOperation({
    summary:
      'Readiness probe: Postgres, Redis, migrations, outbox worker, object storage, config',
  })
  @ApiOkResponse({ description: 'All required dependencies are available' })
  async getReadiness(): Promise<ReadinessResponse> {
    const readiness = await this.healthService.getReadiness();

    if (readiness.status === 'error') {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCIES_UNAVAILABLE',
        message: 'One or more required dependencies are unavailable',
        details: readiness.checks,
      });
    }

    return readiness;
  }

  @Get('dependencies')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Detailed per-dependency status (timings, error messages) for operators',
  })
  @ApiOkResponse({ description: 'Detailed dependency status' })
  getDetailedStatus(): Promise<DetailedStatusResponse> {
    return this.healthService.getDetailedStatus();
  }
}
