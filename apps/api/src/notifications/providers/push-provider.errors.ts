/**
 * Normalized provider errors — mirrors the pattern in maps/providers and
 * auth/providers/sms-ru.errors.ts. Never constructed with a raw device
 * token or service-account credential in `message`.
 */
export type PushErrorKind =
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'circuit_open'
  | 'invalid_token';

export class PushProviderError extends Error {
  constructor(
    readonly kind: PushErrorKind,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PushProviderError';
  }

  static timeout(provider: string): PushProviderError {
    return new PushProviderError(
      'timeout',
      `${provider} push request timed out`,
      true,
    );
  }

  static rateLimited(provider: string): PushProviderError {
    return new PushProviderError(
      'rate_limited',
      `${provider} rate limited the request`,
      true,
    );
  }

  static unavailable(provider: string, detail: string): PushProviderError {
    return new PushProviderError(
      'unavailable',
      `${provider} is unavailable: ${detail}`,
      true,
    );
  }

  static invalidResponse(provider: string): PushProviderError {
    return new PushProviderError(
      'invalid_response',
      `${provider} returned an unrecognized response`,
      false,
    );
  }

  static circuitOpen(provider: string): PushProviderError {
    return new PushProviderError(
      'circuit_open',
      `${provider} circuit is open`,
      false,
    );
  }

  static invalidToken(provider: string): PushProviderError {
    return new PushProviderError(
      'invalid_token',
      `${provider} reported the token as invalid`,
      false,
    );
  }
}
