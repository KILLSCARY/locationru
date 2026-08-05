import { ConfigService } from '@nestjs/config';

import type { ErrorReporter } from './error-reporter.interface.js';
import { NoopErrorReporter } from './noop-error-reporter.js';
import { StagingErrorReporter } from './staging-error-reporter.js';

export function createErrorReporter(
  configService: ConfigService,
): ErrorReporter {
  const reporter = configService.getOrThrow<'noop' | 'staging'>(
    'observability.errorReporter',
  );

  if (reporter === 'staging') return new StagingErrorReporter(configService);
  return new NoopErrorReporter();
}
