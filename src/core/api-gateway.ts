/**
 * API Gateway Service - Phase 3.1
 *
 * Provides centralized request handling, middleware pipeline, and rate limiting
 * for all incoming requests across different interfaces (Telegram, HTTP, CLI)
 */

import { TelemetryService, LogLevel } from '../services/telemetry/telemetry-service.ts';
import { eventBus, SystemEventType } from '../services/event-bus/index.ts';

/**
 * Request interface that normalizes different input formats
 */
export interface GatewayRequest {
  id: string;
  source: string;
  timestamp: Date;
  userId: string;
  content: any;
  metadata: Record<string, unknown>;
  originalRequest: Request;
}

export interface GatewayResponse {
  success: boolean;
  requestId: string;
  timestamp: Date;
  data?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata: {
    processingTime: number;
    middlewareChain: string[];
    source: string;
  };
}

export interface IncomingRequest {
  id: string;
  timestamp: Date;
  source: 'telegram' | 'http' | 'cli';
  userId: string;
  chatId?: string;
  sessionId?: string;
  content: string;
  metadata: Record<string, any>;
  headers?: Record<string, string>;
  rawPayload?: any;
}

/**
 * Gateway response interface
 */
export interface GatewayResponse {
  success: boolean;
  requestId: string;
  timestamp: Date;
  data?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata: {
    processingTime: number;
    middlewareChain: string[];
    source: string;
  };
}

/**
 * Middleware interface for the pipeline
 */
export interface Middleware {
  name: string;
  order: number;
  enabled: boolean;
  execute(request: IncomingRequest): Promise<MiddlewareResult>;
}

/**
 * Middleware execution result
 */
export interface MiddlewareResult {
  success: boolean;
  request?: IncomingRequest; // Modified request
  error?: {
    code: string;
    message: string;
    statusCode?: number;
  };
  metadata?: Record<string, any>;
}

/**
 * Rate limiting configuration per interface
 */
export interface RateLimitConfig {
  windowMs: number;        // Time window in milliseconds
  maxRequests: number;     // Max requests per window
  keyGenerator: (req: IncomingRequest) => string;
  enabled: boolean;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

/**
 * Gateway statistics for monitoring
 */
export interface GatewayStats {
  totalRequests: number;
  requestsPerSecond: number;
  rateLimitedRequests: number;
  averageResponseTime: number;
  errorRate: number;
  activeConnections: number;
  requestsBySource: Record<string, number>;
  middlewareStats: Record<string, {
    executionCount: number;
    averageTime: number;
    errorCount: number;
  }>;
}

/**
 * Gateway configuration
 */
export interface ApiGatewayConfig {
  rateLimiting: {
    telegram: RateLimitConfig;
    http: RateLimitConfig;
    cli: RateLimitConfig;
  };
  middleware: {
    enableAuth: boolean;
    enableValidation: boolean;
    enableTransformation: boolean;
    enableLogging: boolean;
  };
  performance: {
    requestTimeout: number;
    maxConcurrentRequests: number;
  };
  debug: {
    logRequests: boolean;
    logResponses: boolean;
    logMiddleware: boolean;
  };
}

/**
 * Main API Gateway Service
 */
export class ApiGateway {
  private config: ApiGatewayConfig;
  private telemetry: TelemetryService;
  private middlewares: Map<string, Middleware> = new Map();
  private stats: GatewayStats;
  private rateLimitStore = new Map<string, { count: number; resetTime: number }>();
  private activeRequests = new Map<string, { startTime: number; source: string }>();
  private startTime = Date.now();

  constructor(config: ApiGatewayConfig, telemetry: TelemetryService) {
    this.config = config;
    this.telemetry = telemetry;
    this.stats = this.initializeStats();
  }

  /**
   * Initialize the gateway with default middleware
   */
  async initialize(): Promise<void> {
    await this.telemetry.startTrace('ApiGateway', 'initialization');

    try {
      // Import and register middleware components
      const { RateLimitMiddleware } = await import('./gateway-middleware/rate-limit-middleware.ts');
      const { AuthenticationMiddleware } = await import('./gateway-middleware/authentication-middleware.ts');
      const { ValidationMiddleware } = await import('./gateway-middleware/validation-middleware.ts');
      const { TransformationMiddleware } = await import('./gateway-middleware/transformation-middleware.ts');
      const { LoggingMiddleware } = await import('./gateway-middleware/logging-middleware.ts');

      // Register middleware in execution order
      this.addMiddleware(new RateLimitMiddleware(this.config.rateLimiting, this.rateLimitStore));
      this.addMiddleware(new AuthenticationMiddleware(this.config.middleware.enableAuth));
      this.addMiddleware(new ValidationMiddleware(this.config.middleware.enableValidation));
      this.addMiddleware(new TransformationMiddleware(this.config.middleware.enableTransformation));
      this.addMiddleware(new LoggingMiddleware(this.config.middleware.enableLogging, this.telemetry));

      await this.telemetry.info('API Gateway initialized successfully', {
        middlewareCount: this.middlewares.size,
        rateLimitingEnabled: Object.values(this.config.rateLimiting).some(config => config.enabled)
      });

      await this.telemetry.endTrace();

      // Emit initialization event
      eventBus.emit({
        id: `component_initialized_${Date.now()}`,
        type: SystemEventType.COMPONENT_INITIALIZED,
        timestamp: new Date(),
        source: 'ApiGateway',
        payload: {
          componentName: 'ApiGateway',
          timestamp: new Date()
        }
      });

    } catch (error) {
      await this.telemetry.error('Failed to initialize API Gateway', error as Error);
      await this.telemetry.endTrace(undefined, error as Error);
      throw error;
    }
  }

  /**
   * Process incoming request through middleware pipeline
   */
  async processRequest(request: IncomingRequest): Promise<GatewayResponse> {
    const startTime = Date.now();
    const correlationId = await this.telemetry.startTrace('ApiGateway', 'request-processing',
      `req_${request.id}_${Date.now()}`);

    // Track active request
    this.activeRequests.set(request.id, { startTime, source: request.source });
    this.updateRequestStats(request.source);

    let currentRequest = request;
    const middlewareChain: string[] = [];

    try {
      await this.telemetry.info('Processing gateway request', {
        requestId: request.id,
        source: request.source,
        userId: request.userId,
        contentLength: request.content.length
      });

      // Execute middleware pipeline in order
      const sortedMiddleware = Array.from(this.middlewares.values())
        .filter(mw => mw.enabled)
        .sort((a, b) => a.order - b.order);

      for (const middleware of sortedMiddleware) {
        const middlewareStart = Date.now();
        middlewareChain.push(middleware.name);

        await this.telemetry.debug(`Executing middleware: ${middleware.name}`, {
          requestId: request.id,
          middleware: middleware.name
        });

        try {
          const result = await middleware.execute(currentRequest);
          const middlewareTime = Date.now() - middlewareStart;

          this.updateMiddlewareStats(middleware.name, middlewareTime, false);

          if (!result.success) {
            // Middleware rejected the request
            this.stats.rateLimitedRequests++;

            await this.telemetry.warn(`Request rejected by middleware: ${middleware.name}`, {
              requestId: request.id,
              middleware: middleware.name,
              error: result.error
            });

            return this.createErrorResponse(
              request.id,
              request.source,
              middlewareChain,
              startTime,
              result.error?.code || 'MIDDLEWARE_REJECTION',
              result.error?.message || 'Request rejected by middleware',
              result.error?.statusCode || 400
            );
          }

          // Update request if middleware modified it
          if (result.request) {
            currentRequest = result.request;
          }

        } catch (error) {
          const middlewareTime = Date.now() - middlewareStart;
          this.updateMiddlewareStats(middleware.name, middlewareTime, true);

          await this.telemetry.error(`Middleware error: ${middleware.name}`, error as Error, {
            requestId: request.id,
            middleware: middleware.name
          });

          return this.createErrorResponse(
            request.id,
            request.source,
            middlewareChain,
            startTime,
            'MIDDLEWARE_ERROR',
            `Error in middleware: ${middleware.name}`,
            500
          );
        }
      }

      // All middleware passed - forward to system orchestrator
      const { systemOrchestrator } = await import('../main.ts');

      await this.telemetry.info('Forwarding request to system orchestrator', {
        requestId: request.id,
        middlewaresPassed: middlewareChain.length
      });

      // Convert to format expected by system orchestrator
      const orchestratorPayload = this.convertToOrchestratorFormat(currentRequest);
      const orchestratorResult = await systemOrchestrator.handleUpdate(orchestratorPayload);

      const processingTime = Date.now() - startTime;
      this.updateResponseStats(processingTime, true);

      await this.telemetry.info('Gateway request completed successfully', {
        requestId: request.id,
        processingTime,
        middlewareChain: middlewareChain.join(' -> ')
      });

      await this.telemetry.endTrace(orchestratorResult);

      return {
        success: true,
        requestId: request.id,
        timestamp: new Date(),
        data: orchestratorResult,
        metadata: {
          processingTime,
          middlewareChain,
          source: request.source
        }
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateResponseStats(processingTime, false);

      await this.telemetry.error('Gateway request failed', error as Error, {
        requestId: request.id,
        processingTime,
        middlewareChain: middlewareChain.join(' -> ')
      });

      await this.telemetry.endTrace(undefined, error as Error);

      return this.createErrorResponse(
        request.id,
        request.source,
        middlewareChain,
        startTime,
        'PROCESSING_ERROR',
        'Request processing failed',
        500
      );

    } finally {
      // Clean up active request tracking
      this.activeRequests.delete(request.id);
    }
  }

  /**
   * Add middleware to the pipeline
   */
  addMiddleware(middleware: Middleware): void {
    this.middlewares.set(middleware.name, middleware);

    // Initialize middleware stats
    if (!this.stats.middlewareStats[middleware.name]) {
      this.stats.middlewareStats[middleware.name] = {
        executionCount: 0,
        averageTime: 0,
        errorCount: 0
      };
    }
  }

  /**
   * Get current gateway statistics
   */
  getStats(): GatewayStats {
    // Calculate current requests per second
    const uptimeSeconds = (Date.now() - this.startTime) / 1000;
    this.stats.requestsPerSecond = uptimeSeconds > 0 ? this.stats.totalRequests / uptimeSeconds : 0;

    // Calculate error rate
    const totalRequests = this.stats.totalRequests;
    const errorCount = totalRequests - Object.values(this.stats.requestsBySource).reduce((sum, count) => sum + count, 0);
    this.stats.errorRate = totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0;

    // Set active connections
    this.stats.activeConnections = this.activeRequests.size;

    return { ...this.stats };
  }

  /**
   * Configure rate limiting for a specific interface
   */
  configureRateLimit(interfaceType: 'telegram' | 'http' | 'cli', config: RateLimitConfig): void {
    this.config.rateLimiting[interfaceType] = config;

    // Update rate limit middleware if it exists
    const rateLimitMiddleware = this.middlewares.get('RateLimit');
    if (rateLimitMiddleware) {
      (rateLimitMiddleware as any).updateConfig(interfaceType, config);
    }
  }

  /**
   * Get health status of the gateway
   */
  getHealthStatus(): { status: 'healthy' | 'degraded' | 'unhealthy'; details: any } {
    const stats = this.getStats();
    const errorRate = stats.errorRate;
    const avgResponseTime = stats.averageResponseTime;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (errorRate > 10 || avgResponseTime > 5000) {
      status = 'unhealthy';
    } else if (errorRate > 5 || avgResponseTime > 2000) {
      status = 'degraded';
    }

    return {
      status,
      details: {
        stats,
        thresholds: {
          errorRate: { degraded: 5, unhealthy: 10 },
          responseTime: { degraded: 2000, unhealthy: 5000 }
        },
        middlewareCount: this.middlewares.size,
        activeRequests: this.activeRequests.size
      }
    };
  }

  /**
   * Initialize statistics object
   */
  private initializeStats(): GatewayStats {
    return {
      totalRequests: 0,
      requestsPerSecond: 0,
      rateLimitedRequests: 0,
      averageResponseTime: 0,
      errorRate: 0,
      activeConnections: 0,
      requestsBySource: {
        telegram: 0,
        http: 0,
        cli: 0
      },
      middlewareStats: {}
    };
  }

  /**
   * Update request statistics
   */
  private updateRequestStats(source: string): void {
    this.stats.totalRequests++;
    this.stats.requestsBySource[source] = (this.stats.requestsBySource[source] || 0) + 1;
  }

  /**
   * Update response statistics
   */
  private updateResponseStats(processingTime: number, success: boolean): void {
    // Update average response time using exponential moving average
    const alpha = 0.1; // Smoothing factor
    this.stats.averageResponseTime = this.stats.averageResponseTime === 0
      ? processingTime
      : (alpha * processingTime) + ((1 - alpha) * this.stats.averageResponseTime);
  }

  /**
   * Update middleware execution statistics
   */
  private updateMiddlewareStats(name: string, executionTime: number, hasError: boolean): void {
    const stats = this.stats.middlewareStats[name];
    if (stats) {
      stats.executionCount++;

      // Update average time using exponential moving average
      const alpha = 0.1;
      stats.averageTime = stats.averageTime === 0
        ? executionTime
        : (alpha * executionTime) + ((1 - alpha) * stats.averageTime);

      if (hasError) {
        stats.errorCount++;
      }
    }
  }

  /**
   * Create error response
   */
  private createErrorResponse(
    requestId: string,
    source: string,
    middlewareChain: string[],
    startTime: number,
    code: string,
    message: string,
    statusCode = 400
  ): GatewayResponse {
    return {
      success: false,
      requestId,
      timestamp: new Date(),
      error: {
        code,
        message,
        details: { statusCode }
      },
      metadata: {
        processingTime: Date.now() - startTime,
        middlewareChain,
        source
      }
    };
  }

  /**
   * Convert gateway request to system orchestrator format
   */
  private convertToOrchestratorFormat(request: IncomingRequest): any {
    // Convert to TelegramUpdate format that system orchestrator expects
    return {
      update_id: parseInt(request.id),
      message: {
        message_id: Date.now(),
        date: Math.floor(request.timestamp.getTime() / 1000),
        chat: {
          id: parseInt(request.chatId || request.userId),
          type: "private"
        },
        from: {
          id: parseInt(request.userId),
          is_bot: false,
          first_name: `${request.source.charAt(0).toUpperCase() + request.source.slice(1)} User`
        },
        text: request.content
      },
      // Add gateway metadata
      _gateway: {
        source: request.source,
        originalRequest: request,
        processedAt: new Date().toISOString()
      }
    };
  }
}

/**
 * Create default gateway configuration
 */
export function createDefaultGatewayConfig(): ApiGatewayConfig {
  return {
    rateLimiting: {
      telegram: {
        windowMs: 60000, // 1 minute
        maxRequests: 10,
        keyGenerator: (req) => `telegram:${req.userId}:${req.chatId || 'private'}`,
        enabled: true
      },
      http: {
        windowMs: 60000, // 1 minute
        maxRequests: 20,
        keyGenerator: (req) => `http:${req.userId}:${req.sessionId || 'session'}`,
        enabled: true
      },
      cli: {
        windowMs: 60000, // 1 minute
        maxRequests: 30,
        keyGenerator: (req) => `cli:${req.userId}`,
        enabled: true
      }
    },
    middleware: {
      enableAuth: false, // Authentication not required for current implementation
      enableValidation: true,
      enableTransformation: true,
      enableLogging: true
    },
    performance: {
      requestTimeout: 30000, // 30 seconds
      maxConcurrentRequests: 100
    },
    debug: {
      logRequests: true,
      logResponses: true,
      logMiddleware: false
    }
  };
}