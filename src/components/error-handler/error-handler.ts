/**
 * Error Handler implementation
 */

import {
  IErrorHandler,
  ComponentStatus,
  ErrorContext,
  ErrorHandlingResult,
  RetryStrategy,
  CircuitBreakerStatus,
  ErrorCategory,
  CategorizedError,
  IEventEmitter,
} from '../../interfaces/component-interfaces.ts';
import { createErrorRecoveryService } from '../../services/error-recovery-service.ts';
import { EventType, SystemEvent } from '../../interfaces/message-types.ts';
import {
  ErrorHandlerConfig,
  ErrorReport,
  RetryAttempt,
  CircuitBreakerState,
  ErrorMetrics,
  ErrorPattern,
  ErrorBatch,
} from './types.ts';
import { IMessageInterface } from '../../interfaces/message-interface.ts';
import { Platform } from '../../core/protocol/ump-types.ts';
import { interfaces } from 'inversify';
import { TYPES } from '../../core/types.ts';

export class ErrorHandler implements IErrorHandler {
  private config: ErrorHandlerConfig;
  private eventEmitter: IEventEmitter | null = null;
  private messageInterfaceFactory: (platform: Platform) => IMessageInterface;
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private errorMetrics: ErrorMetrics;
  private errorPatterns: Map<string, ErrorPattern> = new Map();
  private reportQueue: ErrorReport[] = [];
  private reportingInterval: number | null = null;
  private isInitialized = false;

  constructor(
    config: ErrorHandlerConfig,
    messageInterfaceFactory: (platform: Platform) => IMessageInterface,
    eventEmitter?: IEventEmitter
  ) {
    this.config = config;
    this.messageInterfaceFactory = messageInterfaceFactory;
    this.eventEmitter = eventEmitter || null;

    this.errorMetrics = {
      totalErrors: 0,
      errorsByCategory: {} as Record<ErrorCategory, number>,
      errorsByComponent: {},
      retrySuccessRate: 0,
      circuitBreakerTrips: 0,
      averageErrorRate: 0,
    };

    Object.values(ErrorCategory).forEach(category => {
      this.errorMetrics.errorsByCategory[category] = 0;
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('ErrorHandler already initialized');
    }

    try {
      if (this.config.reporting.enabled) {
        this.startReportingInterval();
      }
      this.isInitialized = true;
      this.emitEvent({
        type: EventType.COMPONENT_READY,
        source: 'ErrorHandler',
        timestamp: new Date(),
        data: { status: 'initialized' },
      });
    } catch (error) {
      this.emitEvent({
        type: EventType.COMPONENT_ERROR,
        source: 'ErrorHandler',
        timestamp: new Date(),
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
      });
      throw error;
    }
  }

  async handleError(error: Error, context: ErrorContext, platform: Platform): Promise<ErrorHandlingResult> {
    if (!this.isInitialized) {
      console.error('[ROO_DEBUG] ErrorHandler.handleError called before initialization!');
      throw new Error('ErrorHandler not initialized');
    }

    console.log(`[ROO_DEBUG] [ErrorHandler] Handling error for platform: ${platform}`, { error: error.message, context });

    const categorizedError = this.categorizeError(error);
    this.updateMetrics(categorizedError, context);

    const serviceId = `${context.component}:${context.operation}`;
    const circuitBreakerStatus = this.getCircuitBreakerStatus(serviceId);

    if (circuitBreakerStatus.state === 'open') {
      return {
        handled: true,
        retry: false,
        userMessage: this.getUserFriendlyMessage(categorizedError),
        loggedError: true,
        circuitBreakerTripped: true,
      };
    }

    const isRetryable = this.isRetryableError(categorizedError);
    if (!isRetryable || categorizedError.category === ErrorCategory.PERMANENT_FAILURE) {
      this.tripCircuitBreaker(serviceId, categorizedError);
    }

    const report = this.createErrorReport(categorizedError, context);
    if (this.config.reporting.enabled) {
      this.queueErrorReport(report);
    }

    const userMessage = this.getUserFriendlyMessage(categorizedError);
    this.detectErrorPattern(categorizedError, context);

    console.log(`[ROO_DEBUG] [ErrorHandler] Resolved user-friendly message: "${userMessage}"`);
    console.log(`[ROO_DEBUG] [ErrorHandler] Getting message interface from factory for platform: ${platform}`);

    const messageInterface = this.messageInterfaceFactory(platform);

    console.log(`[ROO_DEBUG] [ErrorHandler] Sending message via interface...`, {
      chatId: context.chatId,
      text: userMessage,
      replyToMessageId: context.messageId,
    });

    await messageInterface.sendMessage({
      chatId: context.chatId,
      text: userMessage,
      replyToMessageId: context.messageId,
    });

    console.log(`[ROO_DEBUG] [ErrorHandler] Message sent successfully via interface.`);


    this.emitEvent({
      type: EventType.COMPONENT_ERROR,
      source: 'ErrorHandler',
      timestamp: new Date(),
      data: {
        error: categorizedError.message,
        category: categorizedError.category,
        context,
        reportId: report.id,
      },
    });

    return {
      handled: true,
      retry: isRetryable,
      userMessage,
      loggedError: true,
      circuitBreakerTripped: false,
    };
  }

  isRetryableError(error: Error): boolean {
    const recoveryService = createErrorRecoveryService();
    return recoveryService.isRetryableError(error);
  }

  getRetryStrategy(error: Error, operation: string): RetryStrategy {
    const categorizedError = this.categorizeError(error);
    if (this.config.retries.strategies[operation]) {
      return this.config.retries.strategies[operation];
    }
    const categoryKey = `category:${categorizedError.category}`;
    if (this.config.retries.strategies[categoryKey]) {
      return this.config.retries.strategies[categoryKey];
    }
    return this.config.retries.strategies.default || {
      maxAttempts: 3,
      backoffType: 'exponential',
      initialDelay: 1000,
      maxDelay: 10000,
      retryableErrors: [ErrorCategory.NETWORK_TIMEOUT, ErrorCategory.TEMPORARY_FAILURE],
    };
  }

  getUserFriendlyMessage(error: Error): string {
    const categorizedError = this.categorizeError(error);
    if (this.config.userMessages.categoryMessages[categorizedError.category]) {
      return this.config.userMessages.categoryMessages[categorizedError.category];
    }
    return this.config.userMessages.defaultErrorMessage;
  }

  async reportError(error: Error, context: ErrorContext): Promise<void> {
    if (!this.config.reporting.enabled) {
      return;
    }
    const categorizedError = this.categorizeError(error);
    const report = this.createErrorReport(categorizedError, context);
    await this.sendErrorReport(report);
  }

  getCircuitBreakerStatus(serviceId: string): CircuitBreakerStatus {
    const state = this.circuitBreakers.get(serviceId);
    if (!state) {
      return { serviceId, state: 'closed', failureCount: 0 };
    }
    if (state.status.state === 'open' && state.nextRetryTime && new Date() > state.nextRetryTime) {
      state.status.state = 'half-open';
      state.halfOpenCalls = 0;
    }
    return state.status;
  }

  tripCircuitBreaker(serviceId: string, error: Error): void {
    if (!this.config.circuitBreaker.enabled) {
      return;
    }
    let state = this.circuitBreakers.get(serviceId);
    if (!state) {
      state = {
        serviceId,
        status: { serviceId, state: 'closed', failureCount: 0 },
        failureCount: 0,
        halfOpenCalls: 0,
      };
      this.circuitBreakers.set(serviceId, state);
    }
    state.failureCount++;
    state.status.failureCount = state.failureCount;
    state.status.lastFailureTime = new Date();
    if (state.failureCount >= this.config.circuitBreaker.failureThreshold) {
      state.status.state = 'open';
      state.status.nextRetryTime = new Date(Date.now() + this.config.circuitBreaker.recoveryTimeout);
      this.errorMetrics.circuitBreakerTrips++;
      this.emitEvent({
        type: 'circuit_breaker.tripped',
        source: 'ErrorHandler',
        timestamp: new Date(),
        data: { serviceId, failureCount: state.failureCount, error: error.message },
      });
    }
  }

  getStatus(): ComponentStatus {
    return {
      name: 'ErrorHandler',
      status: this.isInitialized ? 'healthy' : 'unhealthy',
      lastHealthCheck: new Date(),
      metadata: {
        totalErrors: this.errorMetrics.totalErrors,
        circuitBreakers: this.circuitBreakers.size,
        errorPatternsDetected: this.errorPatterns.size,
        reportQueueSize: this.reportQueue.length,
      },
    };
  }

  getMetrics(): ErrorMetrics {
    return { ...this.errorMetrics };
  }

  private categorizeError(error: Error): CategorizedError {
    if (error instanceof CategorizedError) return error;
    let category = ErrorCategory.UNKNOWN;
    if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) category = ErrorCategory.NETWORK_TIMEOUT;
    else if (error.message.includes('network') || error.message.includes('ECONNREFUSED')) category = ErrorCategory.NETWORK_ERROR;
    else if (error.message.includes('rate limit') || error.message.includes('429')) category = ErrorCategory.RATE_LIMIT;
    else if (error.message.includes('401') || error.message.includes('unauthorized')) category = ErrorCategory.AUTHENTICATION;
    else if (error.message.includes('403') || error.message.includes('forbidden')) category = ErrorCategory.PERMISSION_DENIED;
    else if (error.message.includes('404') || error.message.includes('not found')) category = ErrorCategory.NOT_FOUND;
    else if (error.message.includes('invalid') || error.message.includes('validation')) category = ErrorCategory.INVALID_INPUT;
    return new CategorizedError(error.message, category, error);
  }

  private updateMetrics(error: CategorizedError, context: ErrorContext): void {
    this.errorMetrics.totalErrors++;
    this.errorMetrics.errorsByCategory[error.category]++;
    if (!this.errorMetrics.errorsByComponent[context.component]) {
      this.errorMetrics.errorsByComponent[context.component] = 0;
    }
    this.errorMetrics.errorsByComponent[context.component]++;
  }

  private createErrorReport(error: CategorizedError, context: ErrorContext): ErrorReport {
    return {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      error: { name: error.name, message: error.message, stack: error.stack, category: error.category },
      context,
      environment: {
        nodeVersion: globalThis.Deno?.version?.deno || 'unknown',
        platform: globalThis.Deno?.build?.os || 'unknown',
        memory: globalThis.Deno?.memoryUsage?.()?.heapUsed,
        uptime: Date.now() - (globalThis.performance?.timeOrigin || 0),
      },
    };
  }

  private queueErrorReport(report: ErrorReport): void {
    this.reportQueue.push(report);
    if (this.reportQueue.length > 1000) this.reportQueue.shift();
  }

  private async sendErrorReport(report: ErrorReport): Promise<void> {
    if (!this.config.reporting.endpoint) return;
    try {
      const response = await fetch(this.config.reporting.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.reporting.apiKey && { Authorization: `Bearer ${this.config.reporting.apiKey}` }),
        },
        body: JSON.stringify(report),
      });
      if (!response.ok) console.error('Failed to send error report:', response.statusText);
    } catch (error) {
      console.error('Error sending report:', error);
    }
  }

  private startReportingInterval(): void {
    const intervalMs = Math.max(60000 / this.config.reporting.rateLimitPerMinute, 1000);
    this.reportingInterval = setInterval(async () => {
      if (this.reportQueue.length === 0) return;
      const report = this.reportQueue.shift()!;
      await this.sendErrorReport(report);
    }, intervalMs) as any;
  }

  private detectErrorPattern(error: CategorizedError, context: ErrorContext): void {
    const patternKey = `${context.component}:${error.category}:${error.message.substring(0, 100)}`;
    let pattern = this.errorPatterns.get(patternKey);
    if (!pattern) {
      pattern = {
        pattern: patternKey,
        occurrences: 0,
        firstSeen: new Date(),
        lastSeen: new Date(),
        category: error.category,
      };
      this.errorPatterns.set(patternKey, pattern);
    }
    pattern.occurrences++;
    pattern.lastSeen = new Date();
    if (pattern.occurrences >= 5) {
      this.emitEvent({
        type: 'error_pattern.detected',
        source: 'ErrorHandler',
        timestamp: new Date(),
        data: { pattern: patternKey, occurrences: pattern.occurrences, category: error.category, component: context.component },
      });
    }
  }

  private emitEvent(event: SystemEvent): void {
    if (this.eventEmitter) this.eventEmitter.emit(event);
  }

  async shutdown(): Promise<void> {
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
      this.reportingInterval = null;
    }
    if (this.config.reporting.enabled && this.reportQueue.length > 0) {
      const batch: ErrorBatch = {
        id: crypto.randomUUID(),
        errors: this.reportQueue.splice(0),
        timestamp: new Date(),
        batchSize: this.reportQueue.length,
      };
      try {
        if (this.config.reporting.endpoint) {
          await fetch(this.config.reporting.endpoint + '/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.config.reporting.apiKey && { Authorization: `Bearer ${this.config.reporting.apiKey}` }),
            },
            body: JSON.stringify(batch),
          });
        }
      } catch (error) {
        console.error('Failed to send final error batch:', error);
      }
    }
    this.isInitialized = false;
  }
}
