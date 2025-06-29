/**
 * Centralized Error Recovery Service
 * Phase 1.2: Provides consistent error handling and retry logic for all components
 */

import { CircuitBreaker } from '../reliability/circuit-breaker.ts';
import { getCircuitBreakerConfig } from '../reliability/circuit-breaker-configs.ts';
import { createEventEmitter, SystemEventType, ErrorRecoveredEvent } from './event-bus/index.ts';
import { TelemetryService, LogLevel } from './telemetry/index.ts';

/**
 * Error categories for retry behavior classification
 */
export enum ErrorCategory {
  NETWORK_ERROR = 'network_error', // Retryable with backoff
  RATE_LIMIT = 'rate_limit', // Retryable with exponential backoff
  INVALID_REQUEST = 'invalid_request', // Non-retryable
  SERVICE_ERROR = 'service_error', // Retryable with circuit breaker
  UNKNOWN = 'unknown', // Retryable once
}

export interface ErrorRecoveryService {
  isRetryableError(error: Error): boolean;
  handleError(error: Error, context?: Record<string, unknown>): Promise<void>;
  registerRecoveryHandler(
    errorType: Error | ErrorCategory,
    handler: (error: Error) => Promise<void>,
  ): void;
  executeWithRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
}

/**
 * Retry strategy types
 */
export enum RetryStrategy {
  IMMEDIATE = 'immediate',
  EXPONENTIAL_BACKOFF = 'exponential_backoff',
  LINEAR_BACKOFF = 'linear_backoff',
  CIRCUIT_BREAKER = 'circuit_breaker',
}

/**
 * Retry options configuration
 */
export interface RetryOptions {
  strategy?: RetryStrategy;
  maxAttempts: number;
  baseDelay?: number;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
  onFailure?: (error: Error, attempts: number) => void;
  circuitBreakerOptions?: {
    failureThreshold: number;
    successThreshold: number;
    timeout: number;
  };
}

const debugEnabled = Deno.env.get('DEBUG_GATEWAY') === 'true';

export function createErrorRecoveryService(
  telemetry?: TelemetryService,
): ErrorRecoveryService {
  const eventEmitter = createEventEmitter('ErrorRecoveryService');
  const circuitBreakers = new Map<string, CircuitBreaker<unknown>>();
  const recoveryHandlers = new Map<string, (error: Error) => Promise<void>>();

  async function handleNetworkError(error: Error, componentName: string) {
    const strategy = RetryStrategy.EXPONENTIAL_BACKOFF;
    if (debugEnabled) {
      console.log(`[ErrorRecovery] Applying ${strategy} for network error in ${componentName}`);
    }

    eventEmitter.emit<ErrorRecoveredEvent>({
      type: SystemEventType.ERROR_RECOVERED,
      payload: {
        error: error,
        recoveryStrategy: strategy,
        component: componentName,
      },
    });
  }

  return {
    async executeWithRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
      let attempts = 0;
      const maxAttempts = options?.maxAttempts || 3;
      const baseDelay = options?.baseDelay || 1000;

      while (true) {
        try {
          return await fn();
        } catch (error) {
          if (++attempts >= maxAttempts || !this.isRetryableError(error)) {
            if (options?.onFailure) {
              options.onFailure(error as Error, attempts);
            }
            throw error;
          }
          const delay = baseDelay * Math.pow(2, attempts);
          if (options?.onRetry) {
            options.onRetry(error as Error, attempts, delay);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    },

    isRetryableError(error) {
      // Simple implementation - expand based on error types
      return error.message.includes('retryable');
    },

    async handleError(error, context = {}) {
      const componentName = context.componentName?.toString() || 'unknown';

      try {
        await handleNetworkError(error, componentName);
      } catch (recoveryError) {
        telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'ErrorRecoveryService',
          phase: 'recovery_failed',
          message: 'Error recovery attempt failed',
          metadata: {
            originalError: error.message,
            recoveryError: (recoveryError as Error).message,
            component: componentName,
          },
        });
      }
    },

    registerRecoveryHandler(errorType, handler) {
      const key = errorType instanceof Error ? errorType.name : errorType;
      recoveryHandlers.set(key, handler);
    },
  };
}