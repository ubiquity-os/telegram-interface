/**
 * Simple Error Handler Service
 * Handles errors throughout the application
 */

import { eventBus, createEventEmitter, SystemEventType } from './event-bus/index.ts';
import {
  IErrorHandler,
  ErrorContext,
  ErrorHandlingResult,
  RetryStrategy,
  CircuitBreakerStatus,
  ErrorCategory
} from '../interfaces/component-interfaces.ts';

export class SimpleErrorHandler implements IErrorHandler {
  private initialized = false;
  private circuitBreakers = new Map<string, CircuitBreakerStatus>();
  private eventEmitter = createEventEmitter('error-handler');

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Set up global error handlers
    globalThis.addEventListener('error', (event) => {
      this.handleError(new Error(event.error?.message || 'Unknown error'), {
        operation: 'global_error',
        component: 'global'
      });
    });

    globalThis.addEventListener('unhandledrejection', (event) => {
      this.handleError(new Error(event.reason?.message || 'Unhandled promise rejection'), {
        operation: 'promise_rejection',
        component: 'global'
      });
    });

    this.initialized = true;
    console.log('Error handler initialized');
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorHandlingResult> {
    // Log the error
    console.error(`Error in ${context.component}:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      context
    });

    // Emit error event using the event emitter
    await this.eventEmitter.emit({
      type: SystemEventType.ERROR_OCCURRED,
      payload: {
        error,
        context,
        requestId: context.metadata?.requestId
      }
    });

    // Determine if retryable
    const isRetryable = this.isRetryableError(error);

    // Get user-friendly message
    const userMessage = this.getUserFriendlyMessage(error);

    return {
      handled: true,
      retry: isRetryable,
      userMessage,
      loggedError: true,
      circuitBreakerTripped: false
    };
  }

  isRetryableError(error: Error): boolean {
    const retryableErrors = [
      'NetworkError',
      'TimeoutError',
      'TemporaryFailure'
    ];

    return retryableErrors.includes(error.name) ||
           error.message.includes('timeout') ||
           error.message.includes('network') ||
           error.message.includes('connection');
  }

  getRetryStrategy(error: Error, operation: string): RetryStrategy {
    return {
      maxAttempts: 3,
      backoffType: 'exponential',
      initialDelay: 1000,
      maxDelay: 30000,
      retryableErrors: [
        ErrorCategory.NETWORK_TIMEOUT,
        ErrorCategory.NETWORK_ERROR,
        ErrorCategory.TEMPORARY_FAILURE
      ]
    };
  }

  getUserFriendlyMessage(error: Error): string {
    if (error.message.includes('network') || error.message.includes('timeout')) {
      return 'Network connection issue. Please try again.';
    }

    if (error.message.includes('rate limit')) {
      return 'Too many requests. Please wait a moment and try again.';
    }

    return 'An unexpected error occurred. Please try again.';
  }

  async reportError(error: Error, context: ErrorContext): Promise<void> {
    // In production, this would send to monitoring service
    console.error('Error reported:', {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      context,
      timestamp: new Date().toISOString()
    });
  }

  getCircuitBreakerStatus(serviceId: string): CircuitBreakerStatus {
    return this.circuitBreakers.get(serviceId) || {
      serviceId,
      state: 'closed',
      failureCount: 0
    };
  }

  tripCircuitBreaker(serviceId: string, error: Error): void {
    const status = this.getCircuitBreakerStatus(serviceId);
    status.failureCount++;
    status.lastFailureTime = new Date();

    if (status.failureCount >= 5) {
      status.state = 'open';
      status.nextRetryTime = new Date(Date.now() + 60000); // 1 minute
    }

    this.circuitBreakers.set(serviceId, status);
  }
}