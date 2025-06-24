/**
 * Types specific to the Error Handler
 */

import { ErrorCategory, RetryStrategy, CircuitBreakerStatus } from '../../interfaces/component-interfaces.ts';

// Error Handler configuration
export interface ErrorHandlerConfig {
  retries: {
    enabled: boolean;
    strategies: Record<string, RetryStrategy>;
  };
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    recoveryTimeout: number;
    halfOpenMaxCalls: number;
  };
  reporting: {
    enabled: boolean;
    endpoint?: string;
    apiKey?: string;
    includeStackTrace: boolean;
    rateLimitPerMinute: number;
  };
  userMessages: {
    defaultErrorMessage: string;
    categoryMessages: Record<ErrorCategory, string>;
  };
}

// Error report for external monitoring
export interface ErrorReport {
  id: string;
  timestamp: Date;
  error: {
    name: string;
    message: string;
    stack?: string;
    category: ErrorCategory;
  };
  context: {
    operation: string;
    component: string;
    userId?: number;
    chatId?: number;
    metadata?: Record<string, any>;
  };
  environment: {
    nodeVersion: string;
    platform: string;
    memory?: number;
    uptime?: number;
  };
}

// Retry attempt information
export interface RetryAttempt {
  attemptNumber: number;
  delay: number;
  error: Error;
  timestamp: Date;
}

// Circuit breaker state
export interface CircuitBreakerState {
  serviceId: string;
  status: CircuitBreakerStatus;
  failureCount: number;
  lastFailureTime?: Date;
  nextRetryTime?: Date;
  halfOpenCalls: number;
}

// Error handling metrics
export interface ErrorMetrics {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsByComponent: Record<string, number>;
  retrySuccessRate: number;
  circuitBreakerTrips: number;
  averageErrorRate: number;
}

// Error pattern detection
export interface ErrorPattern {
  pattern: string;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  category: ErrorCategory;
  suggested_action?: string;
}

// Batch error reporting
export interface ErrorBatch {
  id: string;
  errors: ErrorReport[];
  timestamp: Date;
  batchSize: number;
}