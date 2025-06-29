/**
 * Logging Middleware - Phase 3.1
 *
 * Handles request/response logging with correlation IDs
 */

import { Middleware, MiddlewareResult, IncomingRequest } from '../api-gateway.ts';
import { TelemetryService, LogLevel } from '../../services/telemetry/telemetry-service.ts';

/**
 * Logging middleware implementation
 */
export class LoggingMiddleware implements Middleware {
  name = 'Logging';
  order = 5; // Last in pipeline
  enabled: boolean;

  private telemetry: TelemetryService;

  constructor(enabled: boolean, telemetry: TelemetryService) {
    this.enabled = enabled;
    this.telemetry = telemetry;
  }

  /**
   * Execute logging
   */
  async execute(request: IncomingRequest): Promise<MiddlewareResult> {
    if (!this.enabled) {
      return { success: true };
    }

    try {
      await this.logRequest(request);
      return {
        success: true,
        metadata: {
          logged: true,
          correlationId: this.telemetry.getCurrentCorrelationId(),
          loggedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      // Don't fail the request if logging fails
      await this.telemetry.error('Logging middleware failed', error as Error, {
        requestId: request.id,
        source: request.source
      });

      return {
        success: true, // Continue processing even if logging fails
        metadata: {
          logged: false,
          logError: (error as Error).message
        }
      };
    }
  }

  /**
   * Log the incoming request
   */
  private async logRequest(request: IncomingRequest): Promise<void> {
    const logData = this.createRequestLogData(request);

    await this.telemetry.logStructured(
      LogLevel.INFO,
      'ApiGateway',
      'request-received',
      `Request received from ${request.source}`,
      logData
    );

    // Log detailed debug information if debug logging is enabled
    if (this.shouldLogDebugDetails(request)) {
      await this.logDebugDetails(request);
    }

    // Log security-relevant information
    await this.logSecurityInfo(request);

    // Log performance metrics
    await this.logPerformanceMetrics(request);
  }

  /**
   * Create structured log data for request
   */
  private createRequestLogData(request: IncomingRequest): Record<string, any> {
    return {
      request: {
        id: request.id,
        source: request.source,
        userId: request.userId,
        chatId: request.chatId,
        sessionId: request.sessionId,
        timestamp: request.timestamp.toISOString(),
        contentLength: request.content.length,
        hasHeaders: !!request.headers && Object.keys(request.headers).length > 0,
        metadataKeys: Object.keys(request.metadata)
      },
      gateway: {
        middlewareChain: ['RateLimit', 'Authentication', 'Validation', 'Transformation', 'Logging'],
        processingStage: 'middleware-pipeline',
        version: '3.1.0'
      },
      source: {
        type: request.source,
        capabilities: this.getSourceCapabilities(request.source),
        authenticated: true // Assume authenticated if reached this point
      }
    };
  }

  /**
   * Check if debug details should be logged
   */
  private shouldLogDebugDetails(request: IncomingRequest): boolean {
    // Log debug details for development or when explicitly enabled
    const debugEnabled = process.env('DEBUG_GATEWAY') === 'true';
    const verboseEnabled = process.env('DEBUG_VERBOSE') === 'true';

    return debugEnabled || verboseEnabled;
  }

  /**
   * Log detailed debug information
   */
  private async logDebugDetails(request: IncomingRequest): Promise<void> {
    const debugData = {
      request: {
        fullContent: request.content,
        headers: request.headers,
        metadata: request.metadata,
        rawPayload: request.rawPayload
      },
      environment: {
        nodeEnv: process.env('ENVIRONMENT'),
        botType: process.env('BOT_TYPE'),
        logLevel: process.env('LOG_LEVEL')
      }
    };

    await this.telemetry.logStructured(
      LogLevel.DEBUG,
      'ApiGateway',
      'request-debug',
      `Debug details for request ${request.id}`,
      debugData
    );
  }

  /**
   * Log security-relevant information
   */
  private async logSecurityInfo(request: IncomingRequest): Promise<void> {
    const securityData = {
      security: {
        userId: request.userId,
        source: request.source,
        contentSanitized: true, // Assume validation middleware sanitized
        rateLimitApplied: true, // Assume rate limit middleware checked
        timestamp: request.timestamp.toISOString(),
        ipAddress: this.extractIpAddress(request),
        userAgent: this.extractUserAgent(request)
      },
      validation: {
        contentLength: request.content.length,
        hasSpecialChars: /[<>'"&]/.test(request.content),
        hasUrls: /https?:\/\//.test(request.content),
        hasNewlines: /\n/.test(request.content)
      }
    };

    await this.telemetry.logStructured(
      LogLevel.INFO,
      'ApiGateway',
      'security-audit',
      `Security audit for request ${request.id}`,
      securityData
    );
  }

  /**
   * Log performance metrics
   */
  private async logPerformanceMetrics(request: IncomingRequest): Promise<void> {
    const performanceData = {
      performance: {
        requestSize: JSON.stringify(request).length,
        contentLength: request.content.length,
        metadataSize: JSON.stringify(request.metadata).length,
        receivedAt: request.timestamp.toISOString(),
        loggedAt: new Date().toISOString(),
        processingDelay: Date.now() - request.timestamp.getTime()
      },
      metrics: {
        source: request.source,
        hasSession: !!request.sessionId,
        hasChat: !!request.chatId,
        headerCount: request.headers ? Object.keys(request.headers).length : 0
      }
    };

    await this.telemetry.logStructured(
      LogLevel.DEBUG,
      'ApiGateway',
      'performance-metrics',
      `Performance metrics for request ${request.id}`,
      performanceData
    );
  }

  /**
   * Extract IP address from request
   */
  private extractIpAddress(request: IncomingRequest): string {
    if (!request.headers) return 'unknown';

    return request.headers['x-forwarded-for'] ||
           request.headers['x-real-ip'] ||
           request.headers['cf-connecting-ip'] ||
           'unknown';
  }

  /**
   * Extract user agent from request
   */
  private extractUserAgent(request: IncomingRequest): string {
    if (!request.headers) return 'unknown';

    return request.headers['user-agent'] || 'unknown';
  }

  /**
   * Get source capabilities for logging
   */
  private getSourceCapabilities(source: string): string[] {
    const capabilities: Record<string, string[]> = {
      telegram: ['text', 'formatting', 'buttons', 'files', 'inline_queries'],
      http: ['text', 'json', 'files', 'streaming', 'rest_api'],
      cli: ['text', 'colors', 'interactive', 'terminal']
    };

    return capabilities[source] || ['text'];
  }

  /**
   * Log response (called from gateway after processing)
   */
  async logResponse(
    requestId: string,
    success: boolean,
    processingTime: number,
    error?: any
  ): Promise<void> {
    if (!this.enabled) return;

    const responseData = {
      response: {
        requestId,
        success,
        processingTime,
        timestamp: new Date().toISOString(),
        hasError: !!error
      },
      performance: {
        processingTimeMs: processingTime,
        performanceCategory: this.categorizePerformance(processingTime)
      }
    };

    if (error) {
      responseData.response = {
        ...responseData.response,
        error: {
          type: error.constructor?.name || 'Error',
          message: error.message || 'Unknown error',
          code: error.code || 'UNKNOWN_ERROR'
        }
      } as any;
    }

    const level = success ? LogLevel.INFO : LogLevel.ERROR;
    const message = success
      ? `Request ${requestId} completed successfully`
      : `Request ${requestId} failed`;

    await this.telemetry.logStructured(
      level,
      'ApiGateway',
      'request-completed',
      message,
      responseData
    );
  }

  /**
   * Categorize performance based on processing time
   */
  private categorizePerformance(processingTime: number): string {
    if (processingTime < 1000) return 'fast';
    if (processingTime < 5000) return 'normal';
    if (processingTime < 10000) return 'slow';
    return 'very_slow';
  }

  /**
   * Create correlation context for request
   */
  async createCorrelationContext(request: IncomingRequest): Promise<string> {
    const correlationId = `${request.source}_${request.id}_${Date.now()}`;

    await this.telemetry.startTrace(
      'ApiGateway',
      'request-processing',
      correlationId
    );

    return correlationId;
  }
}