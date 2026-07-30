import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  ErrorReporter,
  ErrorReporterTrip,
  ErrorReporterUser,
} from './error-reporter.interface.js';
import {
  clearRequestContextIdentity,
  currentRequestContext,
  updateRequestContext,
} from './request-context.js';
import { redactSensitiveData } from './sensitive-data.js';

/**
 * A generic HTTP-JSON adapter, not bound to any specific error-tracking
 * vendor's SDK: it POSTs a redacted JSON event to ERROR_REPORTER_DSN if
 * one is configured, or logs a structured line otherwise so captures are
 * still visible in staging without standing up a real collector.
 *
 * User/trip context lives in the same per-request AsyncLocalStorage as
 * requestId/traceId (see request-context.ts) rather than as fields on
 * this instance — this class is a single Nest provider shared by every
 * concurrent request, so instance-level mutable scope would leak one
 * request's user into another request's captures.
 */
@Injectable()
export class StagingErrorReporter implements ErrorReporter {
  private readonly logger = new Logger(StagingErrorReporter.name);

  constructor(private readonly configService: ConfigService) {}

  captureException(error: unknown, extra?: Record<string, unknown>): void {
    this.send('error', error instanceof Error ? error.message : String(error), {
      ...(error instanceof Error ? { stack: error.stack } : {}),
      ...extra,
    });
  }

  captureMessage(message: string, extra?: Record<string, unknown>): void {
    this.send('message', message, extra);
  }

  setUserContext(user: ErrorReporterUser): void {
    updateRequestContext({ userId: user.id });
  }

  setTripContext(trip: ErrorReporterTrip): void {
    updateRequestContext({ tripId: trip.tripId });
  }

  clearContext(): void {
    clearRequestContextIdentity();
  }

  private send(
    level: 'error' | 'message',
    message: string,
    extra?: Record<string, unknown>,
  ): void {
    const context = currentRequestContext();
    const event = redactSensitiveData({
      level,
      message,
      requestId: context?.requestId,
      traceId: context?.traceId,
      userId: context?.userId,
      tripId: context?.tripId,
      extra,
      timestamp: new Date().toISOString(),
    }) as Record<string, unknown>;

    const dsn = this.configService.get<string>(
      'observability.errorReporterDsn',
    );
    if (!dsn) {
      this.logger.warn({ event: 'error_reporter.capture', ...event });
      return;
    }

    fetch(dsn, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    }).catch((sendError: unknown) => {
      this.logger.warn({
        event: 'error_reporter.send_failed',
        message:
          sendError instanceof Error ? sendError.message : String(sendError),
      });
    });
  }
}
