/**
 * REST Interface Module - REST API interface implementation
 *
 * Implements the InterfaceModule contract for REST API access
 */

import {
  Platform,
  UniversalMessage,
  UniversalResponse,
  UMPError,
  UMPErrorType,
  Session,
  SessionState,
  SessionContext,
  PlatformConnection
} from '../../core/protocol/ump-types.ts';

import { UMPParser, RestApiMessageRequest } from '../../core/protocol/ump-parser.ts';
import { UMPFormatter } from '../../core/protocol/ump-formatter.ts';
import { MessageRouter } from '../../core/message-router.ts';

import {
  InterfaceModule,
  InterfaceModuleConfig,
  InterfaceModuleStatus,
  MessageProcessingResult,
  ConnectionInfo,
  createDefaultInterfaceConfig
} from '../base/interface-module.ts';

/**
 * REST API specific configuration
 */
export interface RestInterfaceConfig extends InterfaceModuleConfig {
  // Server settings
  port: number;
  host: string;

  // API settings
  apiVersion: string;
  basePath: string;

  // CORS settings
  corsOrigins: string[];
  corsCredentials: boolean;

  // Request validation
  maxRequestSize: number;
  validateContentType: boolean;

  // Response settings
  defaultResponseFormat: 'json' | 'xml' | 'plain';
  includeMetadata: boolean;
}

/**
 * REST Interface Module implementation
 */
export class RestInterfaceModule extends InterfaceModule {
  protected config: RestInterfaceConfig;
  private server?: Deno.HttpServer;
  private requestCounter = 0;
  private messageRouter: MessageRouter;

  constructor(config: RestInterfaceConfig, messageRouter: MessageRouter) {
    super(config);
    this.config = config;
    this.messageRouter = messageRouter;
  }

  /**
   * Initialize the REST interface
   */
  async initialize(): Promise<void> {
    this.log('info', 'Initializing REST Interface Module');

    // Validate configuration
    const isValid = await this.validateConfig();
    if (!isValid) {
      throw new UMPError(
        'Invalid REST interface configuration',
        UMPErrorType.VALIDATION_ERROR,
        Platform.REST_API
      );
    }

    this.setStatus(InterfaceModuleStatus.INITIALIZING);
    this.log('info', 'REST Interface Module initialized');
  }

  /**
   * Shutdown the REST interface
   */
  async shutdown(): Promise<void> {
    this.log('info', 'Shutting down REST Interface Module');

    if (this.server) {
      await this.server.shutdown();
      this.server = undefined;
    }

    // Clear active connections
    this.activeConnections.clear();

    this.setStatus(InterfaceModuleStatus.INACTIVE);
    this.log('info', 'REST Interface Module shutdown complete');
  }

  /**
   * Process an incoming REST API message
   */
  async processMessage(
    rawMessage: any,
    connectionInfo?: ConnectionInfo
  ): Promise<MessageProcessingResult> {
    const startTime = Date.now();

    try {
      // Validate message format
      if (!this.isValidRestMessage(rawMessage)) {
        throw new UMPError(
          'Invalid REST API message format',
          UMPErrorType.VALIDATION_ERROR,
          Platform.REST_API
        );
      }

      // Parse to UniversalMessage
      const universalMessage = await UMPParser.parseMessage(
        rawMessage,
        Platform.REST_API,
        connectionInfo?.sessionId
      );

      // Create session object for MessageRouter
      const now = new Date();
      const session: Session = {
        id: connectionInfo?.sessionId || `rest_session_${Date.now()}`,
        userId: connectionInfo?.userId || `rest_user_${Date.now()}`,
        platform: Platform.REST_API,
        createdAt: now,
        lastActiveAt: now,
        state: SessionState.ACTIVE,
        context: {
          messageCount: 1,
          lastMessageAt: now,
          preferences: connectionInfo?.metadata || {}
        },
        platformConnection: {
          platform: Platform.REST_API,
          connectionId: connectionInfo?.id || `rest_conn_${Date.now()}`,
          isConnected: true,
          lastPing: now,
          metadata: connectionInfo?.metadata || {}
        }
      };

      // Route through MessageRouter to get actual AI response
      const response = await this.messageRouter.routeMessage(universalMessage, session);

      // Update metrics
      this.updateMetrics(true, Date.now() - startTime);

      return this.createSuccessResult(response, Date.now() - startTime);

    } catch (error) {
      this.updateMetrics(false, Date.now() - startTime);
      return this.createErrorResult(error as Error, Date.now() - startTime);
    }
  }

  /**
   * Send response back through REST API
   */
  async sendResponse(
    response: UniversalResponse,
    connectionInfo: ConnectionInfo
  ): Promise<void> {
    try {
      // Format response for REST API
      const restResponse = await UMPFormatter.formatResponse(
        response,
        Platform.REST_API
      );

      // In a real implementation, this would send the response back
      // For Phase 1, we just log it
      this.log('debug', `Sending REST response: ${JSON.stringify(restResponse, null, 2)}`);

      // Update connection activity
      this.updateConnectionActivity(connectionInfo.id);

    } catch (error) {
      this.log('error', `Failed to send REST response: ${error.message}`);
      throw new UMPError(
        `Failed to send REST response: ${error.message}`,
        UMPErrorType.CONVERSION_FAILED,
        Platform.REST_API,
        error as Error
      );
    }
  }

  /**
   * Start listening for REST API requests
   */
  async startListening(): Promise<void> {
    if (this.server) {
      this.log('warn', 'REST server is already running');
      return;
    }

    try {
      this.server = Deno.serve({
        port: this.config.port,
        hostname: this.config.host,
        onListen: ({ hostname, port }) => {
          this.log('info', `REST API server listening on http://${hostname}:${port}${this.config.basePath}`);
        }
      }, this.handleRequest.bind(this));

      this.setStatus(InterfaceModuleStatus.ACTIVE);
      this.log('info', 'REST Interface Module started listening');

    } catch (error) {
      this.setStatus(InterfaceModuleStatus.ERROR);
      throw new UMPError(
        `Failed to start REST server: ${error.message}`,
        UMPErrorType.PLATFORM_NOT_SUPPORTED,
        Platform.REST_API,
        error as Error
      );
    }
  }

  /**
   * Stop listening for REST API requests
   */
  async stopListening(): Promise<void> {
    if (this.server) {
      await this.server.shutdown();
      this.server = undefined;
    }

    this.setStatus(InterfaceModuleStatus.INACTIVE);
    this.log('info', 'REST Interface Module stopped listening');
  }

  /**
   * Validate REST interface configuration
   */
  async validateConfig(): Promise<boolean> {
    const errors: string[] = [];

    // Validate port
    if (!this.config.port || this.config.port < 1 || this.config.port > 65535) {
      errors.push('Invalid port number');
    }

    // Validate host
    if (!this.config.host || this.config.host.trim().length === 0) {
      errors.push('Invalid host');
    }

    // Validate base path
    if (!this.config.basePath || !this.config.basePath.startsWith('/')) {
      errors.push('Base path must start with /');
    }

    // Validate CORS origins
    if (!Array.isArray(this.config.corsOrigins)) {
      errors.push('CORS origins must be an array');
    }

    if (errors.length > 0) {
      this.log('error', `Configuration validation failed: ${errors.join(', ')}`);
      return false;
    }

    return true;
  }

  /**
   * Get platform-specific health status
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: Record<string, any>;
  }> {
    const isServerRunning = this.server !== undefined;
    const hasActiveConnections = this.activeConnections.size > 0;
    const errorRate = this.metrics.totalMessages > 0
      ? (this.metrics.failedMessages / this.metrics.totalMessages) * 100
      : 0;

    let status: 'healthy' | 'degraded' | 'unhealthy';

    if (!isServerRunning) {
      status = 'unhealthy';
    } else if (errorRate > 10) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      status,
      details: {
        serverRunning: isServerRunning,
        port: this.config.port,
        host: this.config.host,
        activeConnections: this.activeConnections.size,
        totalRequests: this.metrics.totalMessages,
        errorRate: Math.round(errorRate * 100) / 100,
        averageResponseTime: this.metrics.averageResponseTime,
        uptime: Date.now() - this.startTime
      }
    };
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method;
    const startTime = Date.now();

    try {
      // Apply CORS headers
      const corsHeaders = this.getCorsHeaders(req);

      // Handle preflight requests
      if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // Validate base path
      if (!url.pathname.startsWith(this.config.basePath)) {
        return this.createErrorResponse(
          'Invalid API path',
          404,
          corsHeaders
        );
      }

      // Check rate limits
      const connectionId = this.getConnectionId(req);
      if (!this.checkRateLimit(connectionId)) {
        return this.createErrorResponse(
          'Rate limit exceeded',
          429,
          corsHeaders
        );
      }

      // Authenticate request
      const isAuthenticated = await this.authenticateRequest(req);
      if (!isAuthenticated) {
        return this.createErrorResponse(
          'Authentication failed',
          401,
          corsHeaders
        );
      }

      // Parse request body
      const body = await this.parseRequestBody(req);

      // Create connection info
      const connectionInfo: ConnectionInfo = {
        id: connectionId,
        sessionId: body.sessionId || `rest_session_${connectionId}`,
        userId: body.userId || `rest_user_${connectionId}`,
        platform: Platform.REST_API,
        connectedAt: new Date(),
        lastActivity: new Date(),
        metadata: {
          method,
          path: url.pathname,
          userAgent: req.headers.get('user-agent') || 'unknown'
        }
      };

      // Register connection
      this.registerConnection(connectionInfo);

      // Process message
      const result = await this.processMessage(body, connectionInfo);

      // Create response
      if (result.success && result.response) {
        const restResponse = await UMPFormatter.formatResponse(
          result.response,
          Platform.REST_API
        );

        const responseHeaders = new Headers(corsHeaders);
        responseHeaders.set('Content-Type', 'application/json');

        return new Response(
          JSON.stringify(restResponse, null, 2),
          {
            status: 200,
            headers: responseHeaders
          }
        );
      } else {
        return this.createErrorResponse(
          result.error?.message || 'Processing failed',
          500,
          corsHeaders
        );
      }

    } catch (error) {
      this.log('error', `Request handling error: ${error.message}`);
      return this.createErrorResponse(
        'Internal server error',
        500,
        this.getCorsHeaders(req)
      );
    } finally {
      // Update request counter
      this.requestCounter++;

      // Log request
      const duration = Date.now() - startTime;
      this.log('debug', `${method} ${url.pathname} - ${duration}ms`);
    }
  }

  /**
   * Parse request body
   */
  private async parseRequestBody(req: Request): Promise<RestApiMessageRequest> {
    const contentType = req.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      throw new UMPError(
        'Content-Type must be application/json',
        UMPErrorType.VALIDATION_ERROR,
        Platform.REST_API
      );
    }

    try {
      const body = await req.json();
      return body as RestApiMessageRequest;
    } catch (error) {
      throw new UMPError(
        'Invalid JSON in request body',
        UMPErrorType.VALIDATION_ERROR,
        Platform.REST_API,
        error as Error
      );
    }
  }

  /**
   * Get CORS headers
   */
  private getCorsHeaders(req: Request): Headers {
    const headers = new Headers();
    const origin = req.headers.get('origin');

    if (origin && this.config.corsOrigins.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
    } else if (this.config.corsOrigins.includes('*')) {
      headers.set('Access-Control-Allow-Origin', '*');
    }

    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    headers.set('Access-Control-Max-Age', '86400');

    if (this.config.corsCredentials) {
      headers.set('Access-Control-Allow-Credentials', 'true');
    }

    return headers;
  }

  /**
   * Get connection ID from request
   */
  private getConnectionId(req: Request): string {
    // Use client IP or session ID if available
    const forwarded = req.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : 'unknown';
    return `rest_${ip}_${this.requestCounter}`;
  }

  /**
   * Create error response
   */
  private createErrorResponse(
    message: string,
    status: number,
    additionalHeaders?: Headers
  ): Response {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (additionalHeaders) {
      additionalHeaders.forEach((value, key) => headers.set(key, value));
    }

    const errorBody = {
      success: false,
      error: {
        message,
        status,
        timestamp: new Date().toISOString()
      }
    };

    return new Response(JSON.stringify(errorBody, null, 2), {
      status,
      headers
    });
  }

  /**
   * Validate REST message format
   */
  private isValidRestMessage(message: any): boolean {
    return message &&
           typeof message === 'object' &&
           message.content &&
           typeof message.content === 'string' &&
           message.content.trim().length > 0;
  }
}

/**
 * Create default REST interface configuration
 */
export function createDefaultRestInterfaceConfig(): RestInterfaceConfig {
  return {
    ...createDefaultInterfaceConfig(Platform.REST_API, 'REST API Interface'),
    port: 8080,
    host: '0.0.0.0',
    apiVersion: 'v1',
    basePath: '/api/v1',
    corsOrigins: ['*'],
    corsCredentials: false,
    maxRequestSize: 1024 * 1024, // 1MB
    validateContentType: true,
    defaultResponseFormat: 'json',
    includeMetadata: true
  };
}

/**
 * REST Interface Factory
 */
export class RestInterfaceFactory {
  static create(config?: Partial<RestInterfaceConfig>, messageRouter?: MessageRouter): RestInterfaceModule {
    const fullConfig = { ...createDefaultRestInterfaceConfig(), ...config };
    if (!messageRouter) {
      throw new Error('MessageRouter is required for RestInterfaceModule');
    }
    return new RestInterfaceModule(fullConfig, messageRouter);
  }
}