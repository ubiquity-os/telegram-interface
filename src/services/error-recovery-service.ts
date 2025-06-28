/**
 * Centralized Error Recovery Service
 * Phase 1.2: Provides consistent error handling and retry logic for all components
 */

import { CircuitBreaker } from '../reliability/circuit-breaker.ts';
import { getCircuitBreakerConfig } from '../reliability/circuit-breaker-configs.ts';
import { createEventEmitter } from './event-bus/index.ts';
import type { SystemEvent, EventType } from '../interfaces/message-types.ts';

/**
 * Error categories for retry behavior classification
 */
export enum ErrorCategory {
  NETWORK_ERROR = 'network_error',        // Retryable with backoff
  RATE_LIMIT = 'rate_limit',             // Retryable with exponential backoff
  INVALID_REQUEST = 'invalid_request',    // Non-retryable
  SERVICE_ERROR = 'service_error',        // Retryable with circuit breaker
  UNKNOWN = 'unknown'                     // Retryable once
}

/**
 * Retry strategy types
 */
export enum RetryStrategy {
  IMMEDIATE = 'immediate',
  EXPONENTIAL_BACKOFF = 'exponential_backoff',
  LINEAR_BACKOFF = 'linear_backoff',
  CIRCUIT_BREAKER = 'circuit_breaker'
}

/**
 * Retry options configuration
 */
export interface RetryOptions {
  maxAttempts?: number;
  strategy?: RetryStrategy;
  initialDelay?: number;
  maxDelay?: number;
  circuitBreakerKey?: string;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
  onSuccess?: (result: any, attempts: number) => void;
  onFailure?: (error: Error, attempts: number) => void;
}

/**
 * Default retry configurations per error category
 */
const DEFAULT_RETRY_CONFIG: Record<ErrorCategory, RetryOptions> = {
  [ErrorCategory.NETWORK_ERROR]: {
    maxAttempts: 3,
    strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
    initialDelay: 1000,
    maxDelay: 10000
  },
  [ErrorCategory.RATE_LIMIT]: {
    maxAttempts: 5,
    strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
    initialDelay: 2000,
    maxDelay: 30000
  },
  [ErrorCategory.INVALID_REQUEST]: {
    maxAttempts: 0, // Non-retryable
    strategy: RetryStrategy.IMMEDIATE,
    initialDelay: 0,
    maxDelay: 0
  },
  [ErrorCategory.SERVICE_ERROR]: {
    maxAttempts: 3,
    strategy: RetryStrategy.CIRCUIT_BREAKER,
    initialDelay: 1000,
    maxDelay: 5000
  },
  [ErrorCategory.UNKNOWN]: {
    maxAttempts: 1,
    strategy: RetryStrategy.LINEAR_BACKOFF,
    initialDelay: 1000,
    maxDelay: 5000
  }
};

/**
 * Centralized Error Recovery Service
 */
export class ErrorRecoveryService {
  private circuitBreakers = new Map<string, CircuitBreaker<any>>();
  private eventEmitter = createEventEmitter();

  constructor() {
    console.log('[ErrorRecoveryService] Initialized');
  }

  /**
   * Categorize error based on its characteristics
   */
  categorizeError(error: Error): ErrorCategory {
    const message = error.message.toLowerCase();
    const stack = error.stack?.toLowerCase() || '';

    // Network-related errors
    if (
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('timeout') ||
      message.includes('fetch failed') ||
      stack.includes('fetch')
    ) {
      return ErrorCategory.NETWORK_ERROR;
    }

    // Rate limiting errors
    if (
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('429') ||
      message.includes('quota')
    ) {
      return ErrorCategory.RATE_LIMIT;
    }

    // Invalid request errors (non-retryable)
    if (
      message.includes('400') ||
      message.includes('bad request') ||
      message.includes('invalid') ||
      message.includes('malformed') ||
      message.includes('validation') ||
      message.includes('401') ||
      message.includes('unauthorized') ||
      message.includes('403') ||
      message.includes('forbidden') ||
      message.includes('404') ||
      message.includes('not found')
    ) {
      return ErrorCategory.INVALID_REQUEST;
    }

    // Service errors (5xx, internal errors)
    if (
      message.includes('500') ||
      message.includes('internal server error') ||
      message.includes('service unavailable') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('circuit') ||
      message.includes('upstream')
    ) {
      return ErrorCategory.SERVICE_ERROR;
    }

    // Default to unknown for unclassified errors
    return ErrorCategory.UNKNOWN;
  }

  /**
   * Determine if error should be retried based on category and attempt count
   */
  shouldRetry(error: Error, attemptCount: number): boolean {
    const category = this.categorizeError(error);
    const config = DEFAULT_RETRY_CONFIG[category];

    return attemptCount < config.maxAttempts!;
  }

  /**
   * Calculate retry delay based on strategy and attempt count
   */
  getRetryDelay(error: Error, attemptCount: number): number {
    const category = this.categorizeError(error);
    const config = DEFAULT_RETRY_CONFIG[category];

    switch (config.strategy) {
      case RetryStrategy.IMMEDIATE:
        return 0;

      case RetryStrategy.LINEAR_BACKOFF:
        return Math.min(
          config.initialDelay! * attemptCount,
          config.maxDelay!
        );

      case RetryStrategy.EXPONENTIAL_BACKOFF:
        return Math.min(
          config.initialDelay! * Math.pow(2, attemptCount - 1),
          config.maxDelay!
        );

      case RetryStrategy.CIRCUIT_BREAKER:
        // Use linear backoff for circuit breaker scenarios
        return Math.min(
          config.initialDelay! * attemptCount,
          config.maxDelay!
        );

      default:
        return config.initialDelay!;
    }
  }

  /**
   * Execute operation with automatic retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const category = ErrorCategory.UNKNOWN; // Will be determined from actual error
    const defaultConfig = DEFAULT_RETRY_CONFIG[category];

    const config: Required<RetryOptions> = {
      maxAttempts: options.maxAttempts ?? defaultConfig.maxAttempts!,
      strategy: options.strategy ?? defaultConfig.strategy!,
      initialDelay: options.initialDelay ?? defaultConfig.initialDelay!,
      maxDelay: options.maxDelay ?? defaultConfig.maxDelay!,
      circuitBreakerKey: options.circuitBreakerKey ?? 'default',
      onRetry: options.onRetry ?? (() => {}),
      onSuccess: options.onSuccess ?? (() => {}),
      onFailure: options.onFailure ?? (() => {})
    };

    let lastError: Error;
    let attemptCount = 0;

    while (attemptCount <= config.maxAttempts) {
      attemptCount++;

      try {
        // For circuit breaker strategy, wrap operation in circuit breaker
        if (config.strategy === RetryStrategy.CIRCUIT_BREAKER) {
          const result = await this.executeWithCircuitBreaker(
            operation,
            config.circuitBreakerKey
          );

          config.onSuccess(result, attemptCount);
          this.emitSuccessEvent(config.circuitBreakerKey, attemptCount);
          return result;
        } else {
          // Direct execution for other strategies
          const result = await operation();
          config.onSuccess(result, attemptCount);
          this.emitSuccessEvent('direct', attemptCount);
          return result;
        }

      } catch (error) {
        lastError = error as Error;

        // Determine actual error category for this specific error
        const actualCategory = this.categorizeError(lastError);
        const shouldRetry = this.shouldRetryWithCategory(lastError, attemptCount, actualCategory);

        if (!shouldRetry || attemptCount > config.maxAttempts) {
          // Final failure
          config.onFailure(lastError, attemptCount);
          this.emitFailureEvent(lastError, attemptCount, actualCategory);
          throw lastError;
        }

        // Calculate delay and retry
        const delay = this.getRetryDelayForCategory(lastError, attemptCount, actualCategory);

        config.onRetry(lastError, attemptCount, delay);
        this.emitRetryEvent(lastError, attemptCount, delay, actualCategory);

        if (delay > 0) {
          await this.sleep(delay);
        }
      }
    }

    // Should never reach here, but TypeScript requires it
    throw lastError!;
  }

  /**
   * Execute operation with circuit breaker
   */
  private async executeWithCircuitBreaker<T>(
    operation: () => Promise<T>,
    circuitBreakerKey: string
  ): Promise<T> {
    let circuitBreaker = this.circuitBreakers.get(circuitBreakerKey);

    if (!circuitBreaker) {
      circuitBreaker = new CircuitBreaker(
        circuitBreakerKey,
        getCircuitBreakerConfig('http-api') // Default config
      );
      this.circuitBreakers.set(circuitBreakerKey, circuitBreaker);
    }

    return circuitBreaker.call(operation);
  }

  /**
   * Check if error should be retried with specific category
   */
  private shouldRetryWithCategory(error: Error, attemptCount: number, category: ErrorCategory): boolean {
    const config = DEFAULT_RETRY_CONFIG[category];
    return attemptCount < config.maxAttempts!;
  }

  /**
   * Get retry delay for specific category
   */
  private getRetryDelayForCategory(error: Error, attemptCount: number, category: ErrorCategory): number {
    const config = DEFAULT_RETRY_CONFIG[category];

    switch (config.strategy) {
      case RetryStrategy.IMMEDIATE:
        return 0;

      case RetryStrategy.LINEAR_BACKOFF:
        return Math.min(
          config.initialDelay! * attemptCount,
          config.maxDelay!
        );

      case RetryStrategy.EXPONENTIAL_BACKOFF:
        return Math.min(
          config.initialDelay! * Math.pow(2, attemptCount - 1),
          config.maxDelay!
        );

      case RetryStrategy.CIRCUIT_BREAKER:
        return Math.min(
          config.initialDelay! * attemptCount,
          config.maxDelay!
        );

      default:
        return config.initialDelay!;
    }
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(key: string) {
    const circuitBreaker = this.circuitBreakers.get(key);
    return circuitBreaker?.getStatus() || null;
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(key: string): void {
    const circuitBreaker = this.circuitBreakers.get(key);
    if (circuitBreaker) {
      circuitBreaker.reset();
      console.log(`[ErrorRecoveryService] Reset circuit breaker: ${key}`);
    }
  }

  /**
   * Get all circuit breaker statuses
   */
  getAllCircuitBreakerStatuses() {
    const statuses: Record<string, any> = {};
    for (const [key, breaker] of this.circuitBreakers.entries()) {
      statuses[key] = breaker.getStatus();
    }
    return statuses;
  }

  /**
   * Sleep utility for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Emit success event
   */
  private emitSuccessEvent(operation: string, attempts: number): void {
    this.eventEmitter.emit({
      type: 'error_recovery.success' as EventType,
      source: 'ErrorRecoveryService',
      timestamp: new Date(),
      data: {
        operation,
        attempts,
        success: true
      }
    } as SystemEvent);
  }

  /**
   * Emit failure event
   */
  private emitFailureEvent(error: Error, attempts: number, category: ErrorCategory): void {
    this.eventEmitter.emit({
      type: 'error_recovery.failure' as EventType,
      source: 'ErrorRecoveryService',
      timestamp: new Date(),
      data: {
        error: error.message,
        category,
        attempts,
        success: false
      }
    } as SystemEvent);
  }

  /**
   * Emit retry event
   */
  private emitRetryEvent(error: Error, attempt: number, delay: number, category: ErrorCategory): void {
    console.log(`[ErrorRecoveryService] Retry attempt ${attempt} for ${category} error: ${error.message} (delay: ${delay}ms)`);

    this.eventEmitter.emit({
      type: 'error_recovery.retry' as EventType,
      source: 'ErrorRecoveryService',
      timestamp: new Date(),
      data: {
        error: error.message,
        category,
        attempt,
        delay,
        retrying: true
      }
    } as SystemEvent);
  }
}

// Export singleton instance
export const errorRecoveryService = new ErrorRecoveryService();