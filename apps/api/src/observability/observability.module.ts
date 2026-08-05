import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ERROR_REPORTER } from './error-reporter.interface.js';
import { createErrorReporter } from './error-reporter.factory.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';
import { RequestLoggingInterceptor } from './request-logging.interceptor.js';

/**
 * Global so `app.get(RequestLoggingInterceptor)` resolves it in
 * bootstrap.ts without every feature module needing to import this one.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    RequestLoggingInterceptor,
    MetricsService,
    {
      provide: ERROR_REPORTER,
      inject: [ConfigService],
      useFactory: createErrorReporter,
    },
  ],
  exports: [RequestLoggingInterceptor, ERROR_REPORTER, MetricsService],
})
export class ObservabilityModule {}
