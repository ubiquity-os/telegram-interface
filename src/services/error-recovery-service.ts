/**
 * Centralized Error Recovery Service
 * Phase 1.2: Provides consistent error handling and retry logic for all components
 */

import { CircuitBreaker } from '../reliability/circuit-breaker.ts';
import { getCircuitBreakerConfig } from '../reliability/circuit-breaker-configs.ts';
import { createEventEmitter } from './event-bus/index.ts';
import type { SystemEvent, EventType } from '../interfaces/message-types.ts';
import { TelemetryService, LogLevel } from './telemetry/index.ts';

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
  private telemetry?: TelemetryService;

  constructor() {
    console.log('[ErrorRecoveryService] Initialized');
  }

  /**
   * Set telemetry service for observability
   */
  setTelemetry(telemetry: TelemetryService): void {
    this.telemetry = telemetry;

    this.telemetry.logStructured({
      level: LogLevel.INFO,
      component: 'ErrorRecoveryService',
      phase: 'telemetry_configured',
      message: 'Telemetry service configured for ErrorRecoveryService',
      metadata: {
        circuitBreakerCount: this.circuitBreakers.size
      }
    });
  }

  /**
   * Categorize error based on its characteristics
   */
  categorizeError(error: Error): ErrorCategory {
    const message = error.message.toLowerCase();
    const stack = error.stack?.toLowerCase() || '';

    let category: ErrorCategory;

    // Network-related errors
    if (
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('timeout') ||
      message.includes('fetch failed') ||
      stack.includes('fetch')
    ) {
      category = ErrorCategory.NETWORK_ERROR;
    }
    // Rate limiting errors
    else if (
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('429') ||
      message.includes('quota')
    ) {
      category = ErrorCategory.RATE_LIMIT;
    }
    // Invalid request errors (non-retryable)
    else if (
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
      category = ErrorCategory.INVALID_REQUEST;
    }
    // Service errors (5xx, internal errors)
    else if (
      message.includes('500') ||
      message.includes('internal server error') ||
      message.includes('service unavailable') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('circuit') ||
      message.includes('upstream')
    ) {
      category = ErrorCategory.SERVICE_ERROR;
    }
    // Default to unknown for unclassified errors
    else {
      category = ErrorCategory.UNKNOWN;
    }

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'ErrorRecoveryService',
      phase: 'error_categorized',
      message: 'Error categorized for recovery strategy',
      metadata: {
        category,
        errorMessage: error.message,
        errorType: error.constructor.name,
        hasStack: !!error.stack,
        strategy: DEFAULT_RETRY_CONFIG[category].strategy,
        maxAttempts: DEFAULT_RETRY_CONFIG[category].maxAttempts
      }
    });

    return category;
  }

  /**
   * Determine if error should be retried based on category and attempt count
   */
  shouldRetry(error: Error, attemptCount: number): boolean {
    const category = this.categorizeError(error);
    const config = DEFAULT_RETRY_CONFIG[category];
    const shouldRetry = attemptCount < config.maxAttempts!;

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'ErrorRecoveryService',
      phase: 'retry_decision',
      message: 'Determining if error should be retried',
      metadata: {
        category,
        attemptCount,
        maxAttempts: config.maxAttempts,
        shouldRetry,
        errorMessage: error.message
      }
    });

    return shouldRetry;
  }

  /**
   * Calculate retry delay based on strategy and attempt count
   */
  getRetryDelay(error: Error, attemptCount: number): number {
    const category = this.categorizeError(error);
    const config = DEFAULT_RETRY_CONFIG[category];

    let delay: number;

    switch (config.strategy) {
      case RetryStrategy.IMMEDIATE:
        delay = 0;
        break;

      case RetryStrategy.LINEAR_BACKOFF:
        delay = Math.min(
          config.initialDelay! * attemptCount,
          config.maxDelay!
        );
        break;

      case RetryStrategy.EXPONENTIAL_BACKOFF:
        delay = Math.min(
          config.initialDelay! * Math.pow(2, attemptCount - 1),
          config.maxDelay!
        );
        break;

      case RetryStrategy.CIRCUIT_BREAKER:
        // Use linear backoff for circuit breaker scenarios
        delay = Math.min(
          config.initialDelay! * attemptCount,
          config.maxDelay!
        );
        break;

      default:
        delay = config.initialDelay!;
    }

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'ErrorRecoveryService',
      phase: 'retry_delay_calculated',
      message: 'Retry delay calculated',
      metadata: {
        category,
        strategy: config.strategy,
        attemptCount,
        delay,
        initialDelay: config.initialDelay,
        maxDelay: config.maxDelay
      }
    });

    return delay;
  }

  /**
   * Execute operation with automatic retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const startTime = Date.now();
    const operationId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'ErrorRecoveryService',
      phase: 'retry_operation_start',
      message: 'Starting operation with retry logic',
      metadata: {
        operationId,
        maxAttempts: options.maxAttempts,
        strategy: options.strategy,
        circuitBreakerKey: options.circuitBreakerKey
      }
    });

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

      this.telemetry?.logStructured({
        level: LogLevel.DEBUG,
        component: 'ErrorRecoveryService',
        phase: 'retry_attempt_start',
        message: 'Starting retry attempt',
        metadata: {
          operationId,
          attemptCount,
          maxAttempts: config.maxAttempts,
          strategy: config.strategy
        }
      });

      try {
        // For circuit breaker strategy, wrap operation in circuit breaker
        if (config.strategy === RetryStrategy.CIRCUIT_BREAKER) {
          const result = await this.executeWithCircuitBreaker(
            operation,
            config.circuitBreakerKey
          );

          const executionTime = Date.now() - startTime;

          this.telemetry?.logStructured({
            level: LogLevel.INFO,
            component: 'ErrorRecoveryService',
            phase: 'retry_operation_success',
            message: 'Operation completed successfully with circuit breaker',
            metadata: {
              operationId,
              attemptCount,
              circuitBreakerKey: config.circuitBreakerKey,
              executionTime
            },
            duration: executionTime
          });

          config.onSuccess(result, attemptCount);
          this.emitSuccessEvent(config.circuitBreakerKey, attemptCount);
          return result;
        } else {
          // Direct execution for other strategies
          const result = await operation();
          const executionTime = Date.now() - startTime;

          this.telemetry?.logStructured({
            level: LogLevel.INFO,
            component: 'ErrorRecoveryService',
            phase: 'retry_operation_success',
            message: 'Operation completed successfully',
            metadata: {
              operationId,
              attemptCount,
              strategy: config.strategy,
              executionTime
            },
            duration: executionTime
          });

          config.onSuccess(result, attemptCount);
          this.emitSuccessEvent('direct', attemptCount);
          return result;
        }

      } catch (error) {
        lastError = error as Error;

        // Determine actual error category for this specific error
        const actualCategory = this.categorizeError(lastError);
        const shouldRetry = this.shouldRetryWithCategory(lastError, attemptCount, actualCategory);

        this.telemetry?.logStructured({
          level: LogLevel.WARN,
          component: 'ErrorRecoveryService',
          phase: 'retry_attempt_failed',
          message: 'Retry attempt failed',
          metadata: {
            operationId,
            attemptCount,
            maxAttempts: config.maxAttempts,
            category: actualCategory,
            shouldRetry,
            errorMessage: lastError.message,
            errorType: lastError.constructor.name
          },
          error: lastError
        });

        if (!shouldRetry || attemptCount > config.maxAttempts) {
          // Final failure
          const executionTime = Date.now() - startTime;

          this.telemetry?.logStructured({
            level: LogLevel.ERROR,
            component: 'ErrorRecoveryService',
            phase: 'retry_operation_failed',
            message: 'Operation failed after all retry attempts',
            metadata: {
              operationId,
              finalAttemptCount: attemptCount,
              maxAttempts: config.maxAttempts,
              category: actualCategory,
              executionTime
            },
            error: lastError,
            duration: executionTime
          });

          config.onFailure(lastError, attemptCount);
          this.emitFailureEvent(lastError, attemptCount, actualCategory);
          throw lastError;
        }

        // Calculate delay and retry
        const delay = this.getRetryDelayForCategory(lastError, attemptCount, actualCategory);

        this.telemetry?.logStructured({
          level: LogLevel.INFO,
          component: 'ErrorRecoveryService',
          phase: 'retry_delay',
          message: 'Waiting before retry attempt',
          metadata: {
            operationId,
            attemptCount,
            category: actualCategory,
            delay,
            nextAttempt: attemptCount + 1
          }
        });

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

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'ErrorRecoveryService',
        phase: 'circuit_breaker_created',
        message: 'New circuit breaker created',
        metadata: {
          circuitBreakerKey,
          totalCircuitBreakers: this.circuitBreakers.size
        }
      });
    }

    const status = circuitBreaker.getStatus();

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'ErrorRecoveryService',
      phase: 'circuit_breaker_execution',
      message: 'Executing operation through circuit breaker',
      metadata: {
        circuitBreakerKey,
        state: status.state,
        failureCount: status.failureCount,
        successCount: status.successCount,
        lastFailureTime: status.lastFailureTime
      }
    });

    try {
      const result = await circuitBreaker.call(operation);

      this.telemetry?.logStructured({
        level: LogLevel.DEBUG,
        component: 'ErrorRecoveryService',
        phase: 'circuit_breaker_success',
        message: 'Circuit breaker operation succeeded',
        metadata: {
          circuitBreakerKey,
          newState: circuitBreaker.getStatus().state
        }
      });

      return result;
    } catch (error) {
      this.telemetry?.logStructured({
        level: LogLevel.WARN,
        component: 'ErrorRecoveryService',
        phase: 'circuit_breaker_failure',
        message: 'Circuit breaker operation failed',
        metadata: {
          circuitBreakerKey,
          newState: circuitBreaker.getStatus().state,
          errorMessage: (error as Error).message
        },
        error: error as Error
      });

      throw error;
    }
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
    const status = circuitBreaker?.getStatus() || null;

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'ErrorRecoveryService',
      phase: 'circuit_breaker_status_check',
      message: 'Circuit breaker status checked',
      metadata: {
        circuitBreakerKey: key,
        exists: !!circuitBreaker,
        status: status ? {
          state: status.state,
          failureCount: status.failureCount,
          successCount: status.successCount
        } : null
      }
    });

    return status;
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(key: string): void {
    const circuitBreaker = this.circuitBreakers.get(key);
    if (circuitBreaker) {
      const oldStatus = circuitBreaker.getStatus();
      circuitBreaker.reset();
      const newStatus = circuitBreaker.getStatus();

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'ErrorRecoveryService',
        phase: 'circuit_breaker_reset',
        message: 'Circuit breaker reset successfully',
        metadata: {
          circuitBreakerKey: key,
          oldState: oldStatus.state,
          newState: newStatus.state,
          oldFailureCount: oldStatus.failureCount,
          newFailureCount: newStatus.failureCount
        }
      });

      console.log(`[ErrorRecoveryService] Reset circuit breaker: ${key}`);
    } else {
      this.telemetry?.logStructured({
        level: LogLevel.WARN,
        component: 'ErrorRecoveryService',
        phase: 'circuit_breaker_reset_failed',
        message: 'Attempted to reset non-existent circuit breaker',
        metadata: {
          circuitBreakerKey: key,
          availableKeys: Array.from(this.circuitBreakers.keys())
        }
      });
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

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'ErrorRecoveryService',
      phase: 'all_circuit_breakers_status',
      message: 'Retrieved all circuit breaker statuses',
      metadata: {
        circuitBreakerCount: this.circuitBreakers.size,
        keys: Object.keys(statuses)
      }
    });

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
    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'ErrorRecoveryService',
      phase: 'success_event_emitted',
      message: 'Success event emitted',
      metadata: {
        operation,
        attempts,
        eventType: 'error_recovery.success'
      }
    });

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
    this.telemetry?.logStructured({
      level: LogLevel.ERROR,
      component: 'ErrorRecoveryService',
      phase: 'failure_event_emitted',
      message: 'Failure event emitted',
      metadata: {
        errorMessage: error.message,
        errorType: error.constructor.name,
        category,
        attempts,
        eventType: 'error_recovery.failure'
      },
      error
    });

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
    this.telemetry?.logStructured({
      level: LogLevel.WARN,
      component: 'ErrorRecoveryService',
      phase: 'retry_event_emitted',
      message: 'Retry event emitted',
      metadata: {
        errorMessage: error.message,
        errorType: error.constructor.name,
        category,
        attempt,
        delay,
        eventType: 'error_recovery.retry'
      }
    });

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