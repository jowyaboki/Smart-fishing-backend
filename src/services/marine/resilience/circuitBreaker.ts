import { classifyError, FailureCategory } from './failureClassifier';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Consecutive availability failures to trip (default: 3)
  cooldownMs?: number;       // Duration to remain OPEN before probing (default: 30,000ms)
  maxHalfOpenProbes?: number;// Concurrent probe limit in HALF_OPEN (default: 1)
  clock?: () => number;      // Pluggable clock for deterministic tests
}

export interface CircuitMetrics {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number | null;
  lastFailureCategory: FailureCategory | null;
  lastStateChange: number;
  totalCalls: number;
  totalFailures: number;
  totalRejections: number;
}

export class CircuitBreakerOpenError extends Error {
  public readonly providerId: string;
  public readonly cooldownRemainingMs: number;

  constructor(providerId: string, cooldownRemainingMs: number) {
    super(`[CircuitBreaker] Provider '${providerId}' circuit is OPEN (fast-fail, cooldown remaining: ${cooldownRemainingMs}ms)`);
    this.name = 'CircuitBreakerOpenError';
    this.providerId = providerId;
    this.cooldownRemainingMs = cooldownRemainingMs;
    Object.setPrototypeOf(this, CircuitBreakerOpenError.prototype);
  }
}

/**
 * Robust in-process circuit breaker state machine for protecting external providers.
 */
export class CircuitBreaker {
  public readonly providerId: string;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly maxHalfOpenProbes: number;
  private readonly clock: () => number;

  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastFailureTime: number | null = null;
  private lastFailureCategory: FailureCategory | null = null;
  private lastStateChange: number;
  private currentHalfOpenProbes = 0;

  private totalCalls = 0;
  private totalFailures = 0;
  private totalRejections = 0;

  constructor(providerId: string, options: CircuitBreakerOptions = {}) {
    this.providerId = providerId;
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.cooldownMs = Math.max(100, options.cooldownMs ?? 30000);
    this.maxHalfOpenProbes = Math.max(1, options.maxHalfOpenProbes ?? 1);
    this.clock = options.clock ?? (() => Date.now());
    this.lastStateChange = this.clock();
  }

  /**
   * Executes an action protected by the circuit breaker.
   * Throws CircuitBreakerOpenError if the circuit is OPEN or probe capacity is full.
   */
  public async execute<T>(action: () => Promise<T>): Promise<T> {
    const now = this.clock();
    this.totalCalls++;

    // Check state transitions based on cooldown time
    if (this.state === 'OPEN') {
      const elapsed = now - (this.lastFailureTime ?? this.lastStateChange);
      if (elapsed >= this.cooldownMs) {
        this.transitionTo('HALF_OPEN');
      } else {
        this.totalRejections++;
        throw new CircuitBreakerOpenError(this.providerId, this.cooldownMs - elapsed);
      }
    }

    if (this.state === 'HALF_OPEN') {
      if (this.currentHalfOpenProbes >= this.maxHalfOpenProbes) {
        this.totalRejections++;
        throw new CircuitBreakerOpenError(this.providerId, 0);
      }
      this.currentHalfOpenProbes++;
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  /**
   * Returns current breaker state.
   */
  public getState(): CircuitState {
    const now = this.clock();
    if (this.state === 'OPEN') {
      const elapsed = now - (this.lastFailureTime ?? this.lastStateChange);
      if (elapsed >= this.cooldownMs) {
        this.transitionTo('HALF_OPEN');
      }
    }
    return this.state;
  }

  /**
   * Returns metrics snapshot for observability.
   */
  public getMetrics(): CircuitMetrics {
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
      lastFailureCategory: this.lastFailureCategory,
      lastStateChange: this.lastStateChange,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalRejections: this.totalRejections,
    };
  }

  /**
   * Manually resets the circuit breaker to CLOSED.
   */
  public reset(): void {
    this.consecutiveFailures = 0;
    this.currentHalfOpenProbes = 0;
    this.lastFailureTime = null;
    this.lastFailureCategory = null;
    this.transitionTo('CLOSED');
  }

  /**
   * Manually trips the circuit breaker to OPEN.
   */
  public trip(): void {
    this.lastFailureTime = this.clock();
    this.transitionTo('OPEN');
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.currentHalfOpenProbes = 0;
      this.consecutiveFailures = 0;
      this.transitionTo('CLOSED');
    } else if (this.state === 'CLOSED') {
      this.consecutiveFailures = 0;
    }
  }

  private onFailure(error: unknown): void {
    const classified = classifyError(error);
    if (!classified.isAvailabilityFailure) {
      // Client/validation errors do NOT count toward provider availability failures
      if (this.state === 'HALF_OPEN') {
        this.currentHalfOpenProbes = Math.max(0, this.currentHalfOpenProbes - 1);
      }
      return;
    }

    this.totalFailures++;
    this.consecutiveFailures++;
    this.lastFailureTime = this.clock();
    this.lastFailureCategory = classified.category;

    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.failureThreshold) {
      this.currentHalfOpenProbes = 0;
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.lastStateChange = this.clock();
    }
  }
}
