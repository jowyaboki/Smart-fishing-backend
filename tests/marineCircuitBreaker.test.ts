import { describe, it, expect, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from '../src/services/marine/resilience/circuitBreaker';
import {
  classifyError,
} from '../src/services/marine/resilience/failureClassifier';
import {
  MarineProviderError,
  MarineProviderTimeoutError,
  MarineDataValidationError,
} from '../src/domain/marineModels';

describe('CircuitBreaker Unit Tests', () => {
  it('starts in CLOSED state and stays CLOSED on successful calls', async () => {
    let now = 1000;
    const breaker = new CircuitBreaker('test-provider', {
      failureThreshold: 3,
      cooldownMs: 30000,
      clock: () => now,
    });

    expect(breaker.getState()).toBe('CLOSED');
    const res = await breaker.execute(async () => 'success');
    expect(res).toBe('success');
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getMetrics().consecutiveFailures).toBe(0);
  });

  it('increments failure counter on availability failure and trips to OPEN at threshold', async () => {
    let now = 1000;
    const breaker = new CircuitBreaker('test-provider', {
      failureThreshold: 3,
      cooldownMs: 30000,
      clock: () => now,
    });

    const timeoutError = new MarineProviderTimeoutError('test-provider', 3000);

    // Call 1: failure 1
    await expect(breaker.execute(async () => { throw timeoutError; })).rejects.toThrow(timeoutError);
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getMetrics().consecutiveFailures).toBe(1);

    // Call 2: failure 2
    await expect(breaker.execute(async () => { throw new MarineProviderError('500 Error', 'test-provider', 500); }))
      .rejects.toThrow('500 Error');
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getMetrics().consecutiveFailures).toBe(2);

    // Call 3: failure 3 (reaches threshold -> trips to OPEN)
    await expect(breaker.execute(async () => { throw new MarineProviderError('503 Service Unavailable', 'test-provider', 503); }))
      .rejects.toThrow('503 Service Unavailable');
    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.getMetrics().consecutiveFailures).toBe(3);
  });

  it('immediately fast-fails with CircuitBreakerOpenError when OPEN without calling action', async () => {
    let now = 1000;
    const breaker = new CircuitBreaker('test-provider', {
      failureThreshold: 2,
      cooldownMs: 30000,
      clock: () => now,
    });

    breaker.trip();
    expect(breaker.getState()).toBe('OPEN');

    let actionInvoked = false;
    await expect(
      breaker.execute(async () => {
        actionInvoked = true;
        return 'data';
      })
    ).rejects.toThrow(CircuitBreakerOpenError);

    expect(actionInvoked).toBe(false);
    expect(breaker.getMetrics().totalRejections).toBe(1);
  });

  it('transitions to HALF_OPEN after cooldown elapsed and allows single probe', async () => {
    let now = 1000;
    const breaker = new CircuitBreaker('test-provider', {
      failureThreshold: 2,
      cooldownMs: 30000,
      clock: () => now,
    });

    breaker.trip();
    expect(breaker.getState()).toBe('OPEN');

    // Advance clock past cooldown (30,001 ms)
    now += 30001;
    expect(breaker.getState()).toBe('HALF_OPEN');

    // Probe succeeds -> breaker transitions back to CLOSED
    const res = await breaker.execute(async () => 'probe-success');
    expect(res).toBe('probe-success');
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getMetrics().consecutiveFailures).toBe(0);
  });

  it('re-opens circuit immediately if HALF_OPEN probe fails', async () => {
    let now = 1000;
    const breaker = new CircuitBreaker('test-provider', {
      failureThreshold: 2,
      cooldownMs: 30000,
      clock: () => now,
    });

    breaker.trip();
    now += 30001;
    expect(breaker.getState()).toBe('HALF_OPEN');

    // Probe fails with availability failure -> trips back to OPEN
    await expect(
      breaker.execute(async () => {
        throw new MarineProviderError('502 Bad Gateway', 'test-provider', 502);
      })
    ).rejects.toThrow('502 Bad Gateway');

    expect(breaker.getState()).toBe('OPEN');
  });

  it('limits concurrent probes in HALF_OPEN to maxHalfOpenProbes', async () => {
    let now = 1000;
    const breaker = new CircuitBreaker('test-provider', {
      failureThreshold: 2,
      cooldownMs: 30000,
      maxHalfOpenProbes: 1,
      clock: () => now,
    });

    breaker.trip();
    now += 30001;
    expect(breaker.getState()).toBe('HALF_OPEN');

    let resolveProbe: (v: string) => void;
    const probePromise = new Promise<string>((res) => { resolveProbe = res; });

    // Start probe 1
    const p1 = breaker.execute(() => probePromise);

    // Concurrent probe 2 should be rejected immediately because probe limit is 1
    await expect(breaker.execute(async () => 'probe-2')).rejects.toThrow(CircuitBreakerOpenError);

    resolveProbe!('done');
    await expect(p1).resolves.toBe('done');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('ignores non-availability failures (validation and 4xx client errors) and does not trip breaker', async () => {
    let now = 1000;
    const breaker = new CircuitBreaker('test-provider', {
      failureThreshold: 2,
      clock: () => now,
    });

    const validationErr = new MarineDataValidationError('Invalid coordinate');
    const clientErr = new MarineProviderError('Bad query parameter', 'test-provider', 400);

    await expect(breaker.execute(async () => { throw validationErr; })).rejects.toThrow(validationErr);
    expect(breaker.getMetrics().consecutiveFailures).toBe(0);

    await expect(breaker.execute(async () => { throw clientErr; })).rejects.toThrow(clientErr);
    expect(breaker.getMetrics().consecutiveFailures).toBe(0);
    expect(breaker.getState()).toBe('CLOSED');
  });

  describe('Failure Classifier', () => {
    it('classifies timeouts, 5xx, and 429 as availability failures', () => {
      expect(classifyError(new MarineProviderTimeoutError('p', 1000)).isAvailabilityFailure).toBe(true);
      expect(classifyError(new MarineProviderError('500', 'p', 500)).isAvailabilityFailure).toBe(true);
      expect(classifyError(new MarineProviderError('429 Rate Limit', 'p', 429)).isAvailabilityFailure).toBe(true);
      expect(classifyError(new MarineProviderError('Network disconnected', 'p')).isAvailabilityFailure).toBe(true);
    });

    it('classifies validation and standard 4xx client errors as non-availability', () => {
      expect(classifyError(new MarineDataValidationError('bad coords')).isAvailabilityFailure).toBe(false);
      expect(classifyError(new MarineProviderError('404 Not Found', 'p', 404)).isAvailabilityFailure).toBe(false);
      expect(classifyError(new MarineProviderError('400 Bad Request', 'p', 400)).isAvailabilityFailure).toBe(false);
    });
  });
});
