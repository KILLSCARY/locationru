import { ConfigService } from '@nestjs/config';

import { createErrorReporter } from './error-reporter.factory.js';
import { NoopErrorReporter } from './noop-error-reporter.js';
import { StagingErrorReporter } from './staging-error-reporter.js';

describe('createErrorReporter', () => {
  it('returns a NoopErrorReporter when observability.errorReporter is noop', () => {
    const config = new ConfigService({
      observability: { errorReporter: 'noop' },
    });
    expect(createErrorReporter(config)).toBeInstanceOf(NoopErrorReporter);
  });

  it('returns a StagingErrorReporter when observability.errorReporter is staging', () => {
    const config = new ConfigService({
      observability: { errorReporter: 'staging', errorReporterDsn: '' },
    });
    expect(createErrorReporter(config)).toBeInstanceOf(StagingErrorReporter);
  });
});
