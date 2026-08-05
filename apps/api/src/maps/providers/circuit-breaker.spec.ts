import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('stays closed under the failure threshold', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, openMs: 1_000 });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.canRequest()).toBe(true);
    expect(breaker.currentState).toBe('closed');
  });

  it('opens after the failure threshold is reached', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, openMs: 1_000 });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.currentState).toBe('open');
    expect(breaker.canRequest()).toBe(false);
  });

  it('moves to half-open after the cooldown and closes on success', () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      openMs: 100,
      now: () => now,
    });
    breaker.recordFailure();
    expect(breaker.canRequest()).toBe(false);

    now = 150;
    expect(breaker.canRequest()).toBe(true);
    expect(breaker.currentState).toBe('half_open');

    breaker.recordSuccess();
    expect(breaker.currentState).toBe('closed');
  });

  it('re-opens immediately on a failed half-open trial', () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      openMs: 100,
      now: () => now,
    });
    breaker.recordFailure();
    now = 150;
    expect(breaker.canRequest()).toBe(true);

    breaker.recordFailure();
    expect(breaker.currentState).toBe('open');
    expect(breaker.canRequest()).toBe(false);
  });
});
