/**
 * Normalized provider errors. Adapters translate transport-specific failures
 * (timeouts, HTTP status, JSON shape) into these so the service and controllers
 * never leak a provider's internal error payload to the client.
 */
export type MapsErrorKind =
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'circuit_open';

export class MapsProviderError extends Error {
  constructor(
    readonly kind: MapsErrorKind,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'MapsProviderError';
  }

  static timeout(provider: string): MapsProviderError {
    return new MapsProviderError(
      'timeout',
      `${provider} maps request timed out`,
      true,
    );
  }

  static rateLimited(provider: string): MapsProviderError {
    return new MapsProviderError(
      'rate_limited',
      `${provider} maps provider rate limited the request`,
      true,
    );
  }

  static unavailable(provider: string, detail: string): MapsProviderError {
    return new MapsProviderError(
      'unavailable',
      `${provider} maps provider is unavailable: ${detail}`,
      true,
    );
  }

  static invalidResponse(provider: string): MapsProviderError {
    return new MapsProviderError(
      'invalid_response',
      `${provider} maps provider returned an unrecognized response`,
      false,
    );
  }

  static circuitOpen(provider: string): MapsProviderError {
    return new MapsProviderError(
      'circuit_open',
      `${provider} maps provider circuit is open`,
      false,
    );
  }
}
