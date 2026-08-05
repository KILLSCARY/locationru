export interface ErrorReporterUser {
  id: string;
  role?: string;
}

export interface ErrorReporterTrip {
  tripId: string;
}

/**
 * Deliberately provider-agnostic — nothing in the domain imports a
 * specific error-tracking vendor's SDK, only this interface. Swapping
 * NoopErrorReporter for StagingErrorReporter (or a real vendor adapter
 * later) is a one-line change in error-reporter.factory.ts.
 */
export interface ErrorReporter {
  captureException(error: unknown, extra?: Record<string, unknown>): void;
  captureMessage(message: string, extra?: Record<string, unknown>): void;
  setUserContext(user: ErrorReporterUser): void;
  setTripContext(trip: ErrorReporterTrip): void;
  clearContext(): void;
}

export const ERROR_REPORTER = Symbol('ERROR_REPORTER');
