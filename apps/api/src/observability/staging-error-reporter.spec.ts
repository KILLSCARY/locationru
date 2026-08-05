import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { runWithRequestContext } from './request-context.js';
import { StagingErrorReporter } from './staging-error-reporter.js';

describe('StagingErrorReporter', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as never;
  });

  function makeReporter(dsn = 'https://errors.staging.example/ingest') {
    return new StagingErrorReporter(
      new ConfigService({ observability: { errorReporterDsn: dsn } }),
    );
  }

  it('posts a captured exception to the configured DSN with requestId/traceId attached', async () => {
    const reporter = makeReporter();

    await runWithRequestContext(
      { requestId: 'req-1', traceId: 'trace-1' },
      () => {
        reporter.captureException(new Error('boom'));
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://errors.staging.example/ingest');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.level).toBe('error');
    expect(body.message).toBe('boom');
    expect(body.requestId).toBe('req-1');
    expect(body.traceId).toBe('trace-1');
  });

  it('attaches userId/tripId set via setUserContext/setTripContext', async () => {
    const reporter = makeReporter();

    await runWithRequestContext(
      { requestId: 'req-2', traceId: 'trace-2' },
      () => {
        reporter.setUserContext({ id: 'user-1', role: 'PASSENGER' });
        reporter.setTripContext({ tripId: 'trip-1' });
        reporter.captureMessage('something happened');
      },
    );

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>;
    expect(body.userId).toBe('user-1');
    expect(body.tripId).toBe('trip-1');
  });

  it('clearContext removes userId/tripId from subsequent captures', async () => {
    const reporter = makeReporter();

    await runWithRequestContext(
      { requestId: 'req-3', traceId: 'trace-3' },
      () => {
        reporter.setUserContext({ id: 'user-1' });
        reporter.clearContext();
        reporter.captureMessage('after clear');
      },
    );

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>;
    expect(body.userId).toBeUndefined();
  });

  it('never sends an unredacted phone number embedded in an error message', async () => {
    const reporter = makeReporter();

    await runWithRequestContext(
      { requestId: 'req-4', traceId: 'trace-4' },
      () => {
        reporter.captureException(new Error('failed for +79995551234'));
      },
    );

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('79995551234');
  });

  it('falls back to a structured log line when no DSN is configured', () => {
    const reporter = makeReporter('');
    reporter.captureMessage('no dsn configured');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
