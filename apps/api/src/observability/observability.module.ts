import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ERROR_REPORTER } from './error-reporter.interface.js';
import { createErrorReporter } from './error-reporter.factory.js';
import { RequestLoggingInterceptor } from './request-logging.interceptor.js';

/**
 * Global so `app.get(RequestLoggingInterceptor)` resolves it in
 * bootstrap.ts without every feature module needing to import this one.
 */
@Global()
@Module({
  providers: [
    RequestLoggingInterceptor,
    {
      provide: ERROR_REPORTER,
      inject: [ConfigService],
      useFactory: createErrorReporter,
    },
  ],
  exports: [RequestLoggingInterceptor, ERROR_REPORTER],
})
export class ObservabilityModule {}
