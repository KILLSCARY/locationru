import { Injectable } from '@nestjs/common';

import type { ErrorReporter } from './error-reporter.interface.js';

/**
 * Used in development and test (see error-reporter.factory.ts) — every
 * call is a no-op, so local runs and CI never depend on network access or
 * an external error-tracking account.
 */
@Injectable()
export class NoopErrorReporter implements ErrorReporter {
  captureException(): void {}
  captureMessage(): void {}
  setUserContext(): void {}
  setTripContext(): void {}
  clearContext(): void {}
}
