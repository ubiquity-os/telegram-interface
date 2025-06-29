/**
 * Circuit Breaker Implementation
 *
 * Provides fast failure and prevents cascading failures when external services
 * are down or slow. Implements three states: closed, open, half-open.
 */

export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms before trying half-open state */
  resetTimeout: number;
  /** Window in ms for counting failures */
  monitoringPeriod: number;
  /** Minimum requests before circuit can open */
  minimumRequests: number;
  /** Milliseconds before considering a call "slow" */
  slowCallThreshold: number;
  /** Percentage of slow calls (0-1) before opening circuit */
  slowCallRateThreshold: number;
}

export interface CircuitBreakerMetrics {
  totalCalls: number;
  failedCalls: number;
  slowCalls: number;
  successfulCalls: number;
  rejectedCalls: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
}

export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open'
}

export interface CircuitBreakerStatus {
  name: string;
  state: CircuitBreakerState;
  failureRate: number;
  slowCallRate: number;
  metrics: CircuitBreakerMetrics;
  nextRetryTime?: Date;
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker<T> {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failures = 0;
  private successes = 0;
  private slowCalls = 0;
  private totalCalls = 0;
  private rejectedCalls = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private nextRetryTime?: Date;
  private callWindow: Array<{ timestamp: Date; success: boolean; duration: number }> = [];

  constructor(
    private name: string,
    private config: CircuitBreakerConfig
  ) {}

  async call(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitBreakerState.OPEN) {
      if (this.nextRetryTime && new Date() < this.nextRetryTime) {
        this.rejectedCalls++;
        throw new CircuitOpenError(`Circuit ${this.name} is OPEN. Next retry at ${this.nextRetryTime.toISOString()}`);
      }
      // Try half-open
      this.transitionToHalfOpen();
    }

    const startTime = Date.now();
    this.totalCalls++;

    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      await this.onSuccess(duration);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.onFailure(error as Error, duration);
      throw error;
    }
  }

  private onSuccess(duration: number): void {
    this.successes++;
    this.lastSuccessTime = new Date();

    // Add to call window
    this.addToCallWindow(true, duration);

    // Check for slow calls
    if (duration > this.config.slowCallThreshold) {
      this.slowCalls++;
    }

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.transitionToClosed();
    }

    // Clean up old call window entries
    this.cleanCallWindow();
  }

  private onFailure(error: Error, duration: number): void {
    this.failures++;
    this.lastFailureTime = new Date();

    // Add to call window
    this.addToCallWindow(false, duration);

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.transitionToOpen();
      return;
    }

    // Check if we should open the circuit
    if (this.shouldOpenCircuit()) {
      this.transitionToOpen();
    }

    // Clean up old call window entries
    this.cleanCallWindow();
  }

  private shouldOpenCircuit(): boolean {
    // Need minimum number of calls
    if (this.getRecentCallCount() < this.config.minimumRequests) {
      return false;
    }

    // Check failure rate
    const failureRate = this.getFailureRate();
    if (failureRate >= this.config.failureThreshold / this.config.minimumRequests) {
      return true;
    }

    // Check slow call rate
    const slowCallRate = this.getSlowCallRate();
    if (slowCallRate >= this.config.slowCallRateThreshold) {
      return true;
    }

    return false;
  }

  private transitionToOpen(): void {
    this.state = CircuitBreakerState.OPEN;
    this.nextRetryTime = new Date(Date.now() + this.config.resetTimeout);

    console.warn(`[CircuitBreaker] ${this.name} transitioned to OPEN state. Next retry at ${this.nextRetryTime.toISOString()}`);
  }

  private transitionToHalfOpen(): void {
    this.state = CircuitBreakerState.HALF_OPEN;
    this.nextRetryTime = undefined;

    console.log(`[CircuitBreaker] ${this.name} transitioned to HALF_OPEN state`);
  }

  private transitionToClosed(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failures = 0;
    this.nextRetryTime = undefined;

    console.log(`[CircuitBreaker] ${this.name} transitioned to CLOSED state`);
  }

  private addToCallWindow(success: boolean, duration: number): void {
    this.callWindow.push({
      timestamp: new Date(),
      success,
      duration
    });
  }

  private cleanCallWindow(): void {
    const cutoff = new Date(Date.now() - this.config.monitoringPeriod);
    this.callWindow = this.callWindow.filter(call => call.timestamp > cutoff);
  }

  private getRecentCallCount(): number {
    this.cleanCallWindow();
    return this.callWindow.length;
  }

  private getFailureRate(): number {
    this.cleanCallWindow();
    if (this.callWindow.length === 0) return 0;

    const failures = this.callWindow.filter(call => !call.success).length;
    return failures / this.callWindow.length;
  }

  private getSlowCallRate(): number {
    this.cleanCallWindow();
    if (this.callWindow.length === 0) return 0;

    const slowCalls = this.callWindow.filter(call => call.duration > this.config.slowCallThreshold).length;
    return slowCalls / this.callWindow.length;
  }

  getStatus(): CircuitBreakerStatus {
    return {
      name: this.name,
      state: this.state,
      failureRate: this.getFailureRate(),
      slowCallRate: this.getSlowCallRate(),
      metrics: {
        totalCalls: this.totalCalls,
        failedCalls: this.failures,
        slowCalls: this.slowCalls,
        successfulCalls: this.successes,
        rejectedCalls: this.rejectedCalls,
        lastFailureTime: this.lastFailureTime,
        lastSuccessTime: this.lastSuccessTime
      },
      nextRetryTime: this.nextRetryTime
    };
  }

  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.slowCalls = 0;
    this.totalCalls = 0;
    this.rejectedCalls = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    this.nextRetryTime = undefined;
    this.callWindow = [];

    console.log(`[CircuitBreaker] ${this.name} reset to initial state`);
  }
}