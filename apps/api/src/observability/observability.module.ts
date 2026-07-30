import { Global, Module } from '@nestjs/common';

import { RequestLoggingInterceptor } from './request-logging.interceptor.js';

/**
 * Global so `app.get(RequestLoggingInterceptor)` resolves it in
 * bootstrap.ts without every feature module needing to import this one.
 */
@Global()
@Module({
  providers: [RequestLoggingInterceptor],
  exports: [RequestLoggingInterceptor],
})
export class ObservabilityModule {}
