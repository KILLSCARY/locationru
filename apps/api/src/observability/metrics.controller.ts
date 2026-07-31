import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { MetricsService } from './metrics.service.js';

/**
 * Unauthenticated by design — a Prometheus scrape target, matching every
 * other `/metrics` endpoint. Never exposed publicly: docker-compose.staging
 * / production reverse-proxy config must keep this path internal-network
 * only. See docs/auth/observability.md.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('content-type', 'text/plain; version=0.0.4')
  getMetrics(): string {
    return this.metricsService.renderPrometheusText();
  }
}
