/**
 * Normalized SMS.RU adapter errors. Never constructed with the API key or a
 * raw request URL in `message` — callers (OtpService, admin balance check)
 * only ever see this shape, never SMS.RU's own error payload or query string.
 */
export type SmsRuErrorKind =
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'circuit_open'
  | 'rejected';

export class SmsRuProviderError extends Error {
  constructor(
    readonly kind: SmsRuErrorKind,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SmsRuProviderError';
  }

  static timeout(): SmsRuProviderError {
    return new SmsRuProviderError('timeout', 'SMS.RU request timed out', true);
  }

  static rateLimited(): SmsRuProviderError {
    return new SmsRuProviderError(
      'rate_limited',
      'SMS.RU rate limited the request',
      true,
    );
  }

  static unavailable(detail: string): SmsRuProviderError {
    return new SmsRuProviderError(
      'unavailable',
      `SMS.RU is unavailable: ${detail}`,
      true,
    );
  }

  static invalidResponse(): SmsRuProviderError {
    return new SmsRuProviderError(
      'invalid_response',
      'SMS.RU returned an unrecognized response',
      false,
    );
  }

  static circuitOpen(): SmsRuProviderError {
    return new SmsRuProviderError(
      'circuit_open',
      'SMS.RU circuit is open',
      false,
    );
  }

  /** A well-formed SMS.RU error response (bad number, insufficient funds, etc.) — never retryable, never includes the api_id. */
  static rejected(statusCode: number, statusText: string): SmsRuProviderError {
    return new SmsRuProviderError(
      'rejected',
      `SMS.RU rejected the request (code ${statusCode}): ${statusText}`,
      false,
    );
  }
}
