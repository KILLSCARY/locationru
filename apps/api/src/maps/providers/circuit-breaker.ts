/**
 * Minimal circuit breaker guarding a flaky upstream. After
 * {@link CircuitBreakerOptions.failureThreshold} consecutive failures it opens
 * and short-circuits calls for {@link CircuitBreakerOptions.openMs}; a single
 * trial call in half-open state closes it on success or re-opens it on failure.
 * Deterministic (clock injectable) so it is unit-testable without timers.
 */
export interface CircuitBreakerOptions {
  failureThreshold: number;
  openMs: number;
  now?: () => number;
}

export type CircuitState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: CircuitState = 'closed';
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  /** True when a call may proceed; transitions open → half-open after cooldown. */
  canRequest(): boolean {
    if (this.state === 'open') {
      if (this.now() - this.openedAt >= this.options.openMs) {
        this.state = 'half_open';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    if (
      this.state === 'half_open' ||
      this.failures >= this.options.failureThreshold
    ) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }

  get currentState(): CircuitState {
    return this.state;
  }
}
