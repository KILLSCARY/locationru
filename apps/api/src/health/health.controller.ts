import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  HealthService,
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

  @Get('ready')
  @ApiOperation({ summary: 'Check PostgreSQL and Redis availability' })
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
}
