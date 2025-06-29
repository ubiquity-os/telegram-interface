/**
 * Core API Server - Main HTTP/REST server for platform-agnostic access
 *
 * This server provides REST endpoints that abstract platform differences
 * and routes messages through the existing SystemOrchestrator
 */

import {
  UniversalMessage,
  UniversalResponse,
  Platform,
  Session,
  SessionState,
  UMPError,
  UMPErrorType
} from './protocol/ump-types.ts';

import { UMPParser, RestApiMessageRequest } from './protocol/ump-parser.ts';
import { UMPFormatter, ErrorResponseFormat } from './protocol/ump-formatter.ts';
import { MessageRouter } from './message-router.ts';
import { SessionManager } from './session-manager.ts';
import { ApiGateway, GatewayRequest } from './api-gateway.ts';

/**
 * Core API Server Configuration
 */
export interface CoreApiServerConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  rateLimiting: {
    windowMs: number;
    maxRequests: number;
  };
  authentication: {
    required: boolean;
    apiKeyHeader: string;
    validApiKeys: string[];
  };
  timeouts: {
    requestTimeout: number;
    sessionTimeout: number;
  };
  logging: {
    enabled: boolean;
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

/**
 * Main Core API Server class
 */
export class CoreApiServer {
  private config: CoreApiServerConfig;
  private messageRouter: MessageRouter;
  private sessionManager: SessionManager;
  private gateway: ApiGateway;
  private server?: Deno.HttpServer;
  private rateLimitTracker = new Map<string, { count: number; resetTime: number }>();
  private serverStartTime = Date.now();

  constructor(
    config: CoreApiServerConfig,
    messageRouter: MessageRouter,
    sessionManager: SessionManager,
    gateway: ApiGateway
  ) {
    this.config = config;
    this.messageRouter = messageRouter;
    this.sessionManager = sessionManager;
    this.gateway = gateway;
  }

  /**
   * Start the API server
   */
  async start(): Promise<void> {
    try {
      this.server = Deno.serve({
        port: this.config.port,
        hostname: this.config.host,
        onListen: ({ hostname, port }) => {
          console.log(`[CoreApiServer] Server running at http://${hostname}:${port}`);
          console.log(`[CoreApiServer] Available endpoints:`);
          console.log(`  POST /api/v1/messages - Send message`);
          console.log(`  POST /api/v1/sessions - Create session`);
          console.log(`  GET /api/v1/sessions/:sessionId - Get session`);
          console.log(`  GET /api/v1/health - Health check`);
          console.log(`  GET /api/v1/tools - Available tools`);
        }
      }, this.handleRequest.bind(this));

      this.log('info', 'Core API Server started successfully');
    } catch (error) {
      this.log('error', `Failed to start Core API Server: ${error.message}`);
      throw new UMPError(
        `Failed to start API server: ${error.message}`,
        UMPErrorType.PLATFORM_NOT_SUPPORTED,
        Platform.REST_API,
        error as Error
      );
    }
  }

  /**
   * Stop the API server
   */
  async stop(): Promise<void> {
    if (this.server) {
      await this.server.shutdown();
      this.log('info', 'Core API Server stopped');
    }
  }

  /**
   * Main request handler
   */
  private async handleRequest(req: Request): Promise<Response> {
    const startTime = Date.now();
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname;

    try {
      // Apply CORS headers
      const corsHeaders = this.getCorsHeaders(req);

      // Handle preflight requests
      if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // Apply rate limiting
      const clientId = this.getClientId(req);
      if (!this.checkRateLimit(clientId)) {
        return this.createErrorResponse(
          new UMPError('Rate limit exceeded', UMPErrorType.RATE_LIMIT_EXCEEDED),
          undefined,
          429,
          corsHeaders
        );
      }

      // Apply authentication
      if (this.config.authentication.required) {
        const authResult = this.authenticateRequest(req);
        if (!authResult.isValid) {
          return this.createErrorResponse(
            new UMPError('Authentication failed', UMPErrorType.AUTHENTICATION_FAILED),
            undefined,
            401,
            corsHeaders
          );
        }
      }

      // Route the request
      const response = await this.routeRequest(req, path, method);

      // Add CORS headers to response
      const responseHeaders = new Headers(response.headers);
      corsHeaders.forEach((value, key) => responseHeaders.set(key, value));

      // Log request
      const duration = Date.now() - startTime;
      this.log('info', `${method} ${path} - ${response.status} - ${duration}ms`);

      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      this.log('error', `${method} ${path} - ERROR - ${duration}ms: ${error.message}`);

      return this.createErrorResponse(
        error instanceof UMPError ? error : new UMPError(
          `Internal server error: ${error.message}`,
          UMPErrorType.CONVERSION_FAILED,
          Platform.REST_API,
          error as Error
        ),
        undefined,
        500,
        this.getCorsHeaders(req)
      );
    }
  }

  /**
   * Route requests to appropriate handlers
   */
  private async routeRequest(req: Request, path: string, method: string): Promise<Response> {
    // Health check endpoint
    if (path === '/api/v1/health' && method === 'GET') {
      return this.handleHealthCheck();
    }

    // Send message endpoint
    if (path === '/api/v1/messages' && method === 'POST') {
      return this.handleSendMessage(req);
    }

    // Create session endpoint
    if (path === '/api/v1/sessions' && method === 'POST') {
      return this.handleCreateSession(req);
    }

    // Get session endpoint
    const sessionMatch = path.match(/^\/api\/v1\/sessions\/([^\/]+)$/);
    if (sessionMatch && method === 'GET') {
      return this.handleGetSession(sessionMatch[1]);
    }

    // Available tools endpoint
    if (path === '/api/v1/tools' && method === 'GET') {
      return this.handleGetTools();
    }

    // 404 for unmatched routes
    return this.createErrorResponse(
      new UMPError(`Endpoint not found: ${method} ${path}`, UMPErrorType.NOT_FOUND),
      undefined,
      404
    );
  }

  /**
   * Handle health check requests
   */
  private handleHealthCheck(): Response {
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime: Date.now() - this.serverStartTime,
      platform: Platform.REST_API,
      services: {
        messageRouter: 'healthy',
        sessionManager: 'healthy'
      }
    };

    return new Response(JSON.stringify(healthData, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle send message requests - route through API Gateway
   */
  private async handleSendMessage(req: Request): Promise<Response> {
    try {
      const body = await req.json() as RestApiMessageRequest;

      // Create gateway request for HTTP API
      const gatewayRequest: GatewayRequest = {
        id: `http_api_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        source: 'http' as const,
        timestamp: Date.now(),
        userId: body.userId || 'api_user',
        content: body.message || '',
        metadata: {
          sessionId: body.sessionId,
          endpoint: 'messages',
          apiVersion: 'v1',
          messageMetadata: body.metadata || {}
        },
        originalRequest: req
      };

      // Process through gateway first
      const gatewayResponse = await this.gateway.processRequest(gatewayRequest);

      if (!gatewayResponse.success) {
        this.log('warn', `Gateway rejected HTTP API request: ${gatewayResponse.error}`);
        return this.createErrorResponse(
          new UMPError(
            `Request rejected by gateway: ${gatewayResponse.error}`,
            UMPErrorType.VALIDATION_ERROR,
            Platform.REST_API
          ),
          gatewayRequest.id,
          400
        );
      }

      // Parse to UniversalMessage
      const universalMessage = await UMPParser.parseMessage(
        body,
        Platform.REST_API,
        body.sessionId
      );

      // Validate or create session
      let session = await this.sessionManager.getSession(universalMessage.sessionId);
      if (!session) {
        session = await this.sessionManager.createSession({
          userId: universalMessage.userId,
          platform: Platform.REST_API,
          metadata: body.metadata || {}
        });
      }

      // Route message through system
      const universalResponse = await this.messageRouter.routeMessage(
        universalMessage,
        session
      );

      // Format response for REST API
      const formattedResponse = await UMPFormatter.formatResponse(
        universalResponse,
        Platform.REST_API
      );

      // Include gateway metrics in response
      const responseWithMetrics = {
        ...formattedResponse,
        gateway: {
          processed: true,
          metrics: gatewayResponse.metrics,
          requestId: gatewayRequest.id
        }
      };

      return new Response(JSON.stringify(responseWithMetrics, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      this.log('error', `Send message error: ${error.message}`);

      return this.createErrorResponse(
        error instanceof UMPError ? error : new UMPError(
          `Failed to process message: ${error.message}`,
          UMPErrorType.CONVERSION_FAILED,
          Platform.REST_API,
          error as Error
        )
      );
    }
  }

  /**
   * Handle create session requests
   */
  private async handleCreateSession(req: Request): Promise<Response> {
    try {
      const body = await req.json();

      if (!body.userId || typeof body.userId !== 'string') {
        throw new UMPError(
          'userId is required and must be a string',
          UMPErrorType.VALIDATION_ERROR,
          Platform.REST_API
        );
      }

      const session = await this.sessionManager.createSession({
        userId: body.userId,
        platform: Platform.REST_API,
        metadata: body.metadata || {}
      });

      return new Response(JSON.stringify({
        success: true,
        session: {
          id: session.id,
          userId: session.userId,
          platform: session.platform,
          state: session.state,
          createdAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt?.toISOString()
        }
      }, null, 2), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      return this.createErrorResponse(
        error instanceof UMPError ? error : new UMPError(
          `Failed to create session: ${error.message}`,
          UMPErrorType.CONVERSION_FAILED,
          Platform.REST_API,
          error as Error
        )
      );
    }
  }

  /**
   * Handle get session requests
   */
  private async handleGetSession(sessionId: string): Promise<Response> {
    try {
      const session = await this.sessionManager.getSession(sessionId);

      if (!session) {
        throw new UMPError(
          `Session not found: ${sessionId}`,
          UMPErrorType.NOT_FOUND,
          Platform.REST_API
        );
      }

      return new Response(JSON.stringify({
        success: true,
        session: {
          id: session.id,
          userId: session.userId,
          platform: session.platform,
          state: session.state,
          createdAt: session.createdAt.toISOString(),
          lastActiveAt: session.lastActiveAt.toISOString(),
          expiresAt: session.expiresAt?.toISOString(),
          context: session.context
        }
      }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      return this.createErrorResponse(
        error instanceof UMPError ? error : new UMPError(
          `Failed to get session: ${error.message}`,
          UMPErrorType.CONVERSION_FAILED,
          Platform.REST_API,
          error as Error
        )
      );
    }
  }

  /**
   * Handle get tools requests
   */
  private async handleGetTools(): Promise<Response> {
    try {
      const tools = await this.messageRouter.getAvailableTools();

      return new Response(JSON.stringify({
        success: true,
        tools: tools.map(tool => ({
          serverId: tool.serverId,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }))
      }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      return this.createErrorResponse(
        new UMPError(
          `Failed to get tools: ${error.message}`,
          UMPErrorType.CONVERSION_FAILED,
          Platform.REST_API,
          error as Error
        )
      );
    }
  }

  /**
   * Create error response
   */
  private createErrorResponse(
    error: UMPError,
    requestId?: string,
    status = 400,
    additionalHeaders?: Headers
  ): Response {
    const errorResponse = UMPFormatter.createErrorResponse(error, requestId, Platform.REST_API);

    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (additionalHeaders) {
      additionalHeaders.forEach((value, key) => headers.set(key, value));
    }

    return new Response(JSON.stringify(errorResponse, null, 2), {
      status,
      headers
    });
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

    return headers;
  }

  /**
   * Authenticate request
   */
  private authenticateRequest(req: Request): { isValid: boolean; userId?: string } {
    const apiKey = req.headers.get(this.config.authentication.apiKeyHeader);

    if (!apiKey) {
      return { isValid: false };
    }

    const isValid = this.config.authentication.validApiKeys.includes(apiKey);
    return { isValid, userId: isValid ? `api_user_${apiKey.slice(-8)}` : undefined };
  }

  /**
   * Check rate limit
   */
  private checkRateLimit(clientId: string): boolean {
    const now = Date.now();
    const windowMs = this.config.rateLimiting.windowMs;
    const maxRequests = this.config.rateLimiting.maxRequests;

    const tracker = this.rateLimitTracker.get(clientId);

    if (!tracker || now > tracker.resetTime) {
      // Reset or create new tracker
      this.rateLimitTracker.set(clientId, {
        count: 1,
        resetTime: now + windowMs
      });
      return true;
    }

    if (tracker.count >= maxRequests) {
      return false;
    }

    tracker.count++;
    return true;
  }

  /**
   * Get client ID for rate limiting
   */
  private getClientId(req: Request): string {
    // Try to get client ID from API key
    const apiKey = req.headers.get(this.config.authentication.apiKeyHeader);
    if (apiKey) {
      return `api_${apiKey.slice(-8)}`;
    }

    // Fall back to IP address (simplified for demo)
    const forwarded = req.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : 'unknown';
    return `ip_${ip}`;
  }

  /**
   * Log message
   */
  private log(level: string, message: string): void {
    if (!this.config.logging.enabled) {
      return;
    }

    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevelIndex = levels.indexOf(this.config.logging.level);
    const messageLevelIndex = levels.indexOf(level);

    if (messageLevelIndex >= configLevelIndex) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${level.toUpperCase()}] [CoreApiServer] ${message}`);
    }
  }
}

/**
 * Create default configuration for Core API Server
 */
export function createDefaultCoreApiServerConfig(): CoreApiServerConfig {
  return {
    port: 8001, // Different from existing webhook server (8000)
    host: '0.0.0.0',
    corsOrigins: ['*'], // Allow all origins in development
    rateLimiting: {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 100 // 100 requests per minute
    },
    authentication: {
      required: true,
      apiKeyHeader: 'X-API-Key',
      validApiKeys: [] // Will be populated from environment
    },
    timeouts: {
      requestTimeout: 30000, // 30 seconds
      sessionTimeout: 30 * 60 * 1000 // 30 minutes
    },
    logging: {
      enabled: true,
      level: 'info'
    }
  };
}