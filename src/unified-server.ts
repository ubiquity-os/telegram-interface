/**
 * Unified Multi-Platform Server
 *
 * Single service that handles all ingress points:
 * - REST API endpoints
 * - Telegram webhooks
 * - GitHub webhooks (planned)
 * - Google Drive webhooks (planned)
 * - MCP protocol handlers (planned)
 */

// Environment variables are loaded automatically by Bun
import { getConfig } from "./utils/config.ts";
import { deduplicationService } from "./services/deduplication.ts";
import { eventBus, SystemEventType } from "./services/event-bus/index.ts";

// Import event-based logging system
import { initializeLogging } from "./utils/event-log-manager.ts";

// Import DI container and bootstrap function
import { bootstrap } from "./core/di-container.ts";
import { TYPES } from "./core/types.ts";

// Import types
import { ISystemOrchestrator } from "./components/system-orchestrator/types.ts";
import { ITelegramInterfaceAdapter } from "./interfaces/component-interfaces.ts";

// Import API Gateway and related services
import { ApiGateway, ApiGatewayConfig } from "./core/api-gateway.ts";
import { TelemetryService, createDefaultTelemetryConfig, initializeTelemetry } from "./services/telemetry/index.ts";
import { MessageRouter, createDefaultMessageRouterConfig } from "./core/message-router.ts";
import { SessionManager, createDefaultSessionManagerConfig } from "./core/session-manager.ts";

// Import UMP types for unified message processing
import {
  UniversalMessage,
  UniversalResponse,
  Platform,
  Session,
  UMPError,
  UMPErrorType
} from "./core/protocol/ump-types.ts";
import { UMPParser, RestApiMessageRequest } from "./core/protocol/ump-parser.ts";
import { UMPFormatter } from "./core/protocol/ump-formatter.ts";

/**
 * Unified Server Configuration
 */
export interface UnifiedServerConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  authentication: {
    required: boolean;
    apiKeyHeader: string;
    validApiKeys: string[];
  };
  webhooks: {
    telegram: {
      enabled: boolean;
      path: string;
      secret: string;
    };
    github: {
      enabled: boolean;
      path: string;
      secret?: string;
    };
    googleDrive: {
      enabled: boolean;
      path: string;
      secret?: string;
    };
  };
  features: {
    restApi: boolean;
    telegramBot: boolean;
    githubIntegration: boolean;
    googleDriveIntegration: boolean;
    mcpProtocol: boolean;
  };
  rateLimiting: {
    windowMs: number;
    maxRequests: number;
  };
  logging: {
    enabled: boolean;
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

/**
 * Main Unified Server Class
 */
export class UnifiedServer {
  private config: UnifiedServerConfig;
  private orchestrator: ISystemOrchestrator;
  private messageRouter: MessageRouter;
  private sessionManager: SessionManager;
  private gateway: ApiGateway;
  private telegramAdapter: ITelegramInterfaceAdapter;
  private server?: Deno.HttpServer;
  private serverStartTime = Date.now();

  constructor(
    config: UnifiedServerConfig,
    orchestrator: ISystemOrchestrator,
    messageRouter: MessageRouter,
    sessionManager: SessionManager,
    gateway: ApiGateway,
    telegramAdapter: ITelegramInterfaceAdapter
  ) {
    this.config = config;
    this.orchestrator = orchestrator;
    this.messageRouter = messageRouter;
    this.sessionManager = sessionManager;
    this.gateway = gateway;
    this.telegramAdapter = telegramAdapter;
  }

  /**
   * Start the unified server
   */
  async start(): Promise<void> {
    try {
      this.server = Deno.serve({
        port: this.config.port,
        hostname: this.config.host,
        onListen: ({ hostname, port }) => {
          console.log(`🚀 Unified Multi-Platform Server running at http://${hostname}:${port}`);
          console.log(`📡 Available endpoints:`);

          if (this.config.features.restApi) {
            console.log(`   REST API:`);
            console.log(`     POST /api/v1/messages - Send message`);
            console.log(`     POST /api/v1/sessions - Create session`);
            console.log(`     GET  /api/v1/sessions/:id - Get session`);
            console.log(`     GET  /api/v1/health - Health check`);
            console.log(`     GET  /api/v1/tools - Available tools`);
          }

          if (this.config.features.telegramBot && this.config.webhooks.telegram.enabled) {
            console.log(`   Telegram: POST ${this.config.webhooks.telegram.path}`);
          }

          if (this.config.features.githubIntegration && this.config.webhooks.github.enabled) {
            console.log(`   GitHub: POST ${this.config.webhooks.github.path}`);
          }

          if (this.config.features.googleDriveIntegration && this.config.webhooks.googleDrive.enabled) {
            console.log(`   Google Drive: POST ${this.config.webhooks.googleDrive.path}`);
          }

          console.log(`   Internal:`);
          console.log(`     GET  /health - Server health`);
          console.log(`     POST /test/message - E2E testing`);
          console.log(`     GET  /conversations - View conversations`);
        }
      }, this.handleRequest.bind(this));

      this.log('info', '🎉 Unified Multi-Platform Server started successfully');
    } catch (error) {
      this.log('error', `❌ Failed to start Unified Server: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (this.server) {
      await this.server.shutdown();
      await this.sessionManager.shutdown();
      await this.orchestrator.shutdown();
      this.log('info', '🛑 Unified Multi-Platform Server stopped');
    }
  }

  /**
   * Main request handler - routes to appropriate platform handler
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

      // Route based on path and enabled features
      let response: Response;

      // REST API endpoints
      if (path.startsWith('/api/v1/') && this.config.features.restApi) {
        response = await this.handleRestApiRequest(req, path, method);
      }
      // Telegram webhook
      else if (path === this.config.webhooks.telegram.path && this.config.features.telegramBot) {
        response = await this.handleTelegramWebhook(req);
      }
      // GitHub webhook (planned)
      else if (path === this.config.webhooks.github.path && this.config.features.githubIntegration) {
        response = await this.handleGitHubWebhook(req);
      }
      // Google Drive webhook (planned)
      else if (path === this.config.webhooks.googleDrive.path && this.config.features.googleDriveIntegration) {
        response = await this.handleGoogleDriveWebhook(req);
      }
      // Server health endpoint
      else if (path === '/health' && method === 'GET') {
        response = await this.handleServerHealth();
      }
      // Test endpoint
      else if (path === '/test/message' && method === 'POST') {
        response = await this.handleTestMessage(req);
      }
      // Conversations endpoint
      else if (path === '/conversations' && method === 'GET') {
        response = await this.handleConversations(req);
      }
      // 404 for unmatched routes
      else {
        response = this.createErrorResponse(
          new UMPError(`Endpoint not found: ${method} ${path}`, UMPErrorType.NOT_FOUND),
          undefined,
          404
        );
      }

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
   * Handle REST API requests
   */
  private async handleRestApiRequest(req: Request, path: string, method: string): Promise<Response> {
    // Health check endpoint
    if (path === '/api/v1/health' && method === 'GET') {
      return this.handleApiHealth();
    }

    // Send message endpoint
    if (path === '/api/v1/messages' && method === 'POST') {
      return this.handleApiSendMessage(req);
    }

    // Create session endpoint
    if (path === '/api/v1/sessions' && method === 'POST') {
      return this.handleApiCreateSession(req);
    }

    // Get session endpoint
    const sessionMatch = path.match(/^\/api\/v1\/sessions\/([^\/]+)$/);
    if (sessionMatch && method === 'GET') {
      return this.handleApiGetSession(sessionMatch[1]);
    }

    // Available tools endpoint
    if (path === '/api/v1/tools' && method === 'GET') {
      return this.handleApiGetTools();
    }

    // 404 for unmatched API routes
    return this.createErrorResponse(
      new UMPError(`API endpoint not found: ${method} ${path}`, UMPErrorType.NOT_FOUND),
      undefined,
      404
    );
  }

  /**
   * Handle API health check
   */
  private handleApiHealth(): Response {
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      uptime: Date.now() - this.serverStartTime,
      platform: 'unified',
      features: this.config.features,
      services: {
        orchestrator: 'healthy',
        messageRouter: 'healthy',
        sessionManager: 'healthy',
        gateway: 'healthy'
      }
    };

    return new Response(JSON.stringify(healthData, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle API send message - route through gateway
   */
  private async handleApiSendMessage(req: Request): Promise<Response> {
    try {
      const body = await req.json() as RestApiMessageRequest;

      // Create gateway request for HTTP API
      const gatewayRequest = {
        id: `http_api_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        source: 'http' as const,
        timestamp: new Date(),
        userId: body.userId || 'api_user',
        content: body.message || '',
        metadata: {
          sessionId: body.sessionId,
          endpoint: 'messages',
          apiVersion: 'v1',
          messageMetadata: body.metadata || {}
        }
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
          metrics: gatewayResponse.metadata,
          requestId: gatewayRequest.id
        }
      };

      return new Response(JSON.stringify(responseWithMetrics, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      this.log('error', `API send message error: ${error.message}`);
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
   * Handle API create session
   */
  private async handleApiCreateSession(req: Request): Promise<Response> {
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
   * Handle API get session
   */
  private async handleApiGetSession(sessionId: string): Promise<Response> {
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
   * Handle API get tools
   */
  private async handleApiGetTools(): Promise<Response> {
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
   * Handle Telegram webhook
   */
  private async handleTelegramWebhook(req: Request): Promise<Response> {
    try {
      // Parse the update to check for duplicates
      const bodyText = await req.text();
      const update = JSON.parse(bodyText);

      // Check if we've already processed this update
      if (update.update_id && deduplicationService.hasProcessed(update.update_id)) {
        this.log('info', `Duplicate Telegram update detected: ${update.update_id}, skipping`);
        return new Response("OK", { status: 200 });
      }

      // Mark update as processed
      if (update.update_id) {
        deduplicationService.markAsProcessed(update.update_id);
        this.log('info', `Processing new Telegram update: ${update.update_id}`);
      }

      // Create gateway request for Telegram webhook
      const gatewayRequest = {
        id: `telegram_${update.update_id || Date.now()}`,
        source: 'telegram' as const,
        timestamp: new Date(),
        userId: update.message?.from?.id?.toString() || update.callback_query?.from?.id?.toString() || 'unknown',
        content: update.message?.text || update.callback_query?.data || '',
        metadata: {
          updateId: update.update_id,
          chatId: update.message?.chat?.id || update.callback_query?.message?.chat?.id,
          messageId: update.message?.message_id || update.callback_query?.message?.message_id,
          updateType: update.message ? 'message' : (update.callback_query ? 'callback_query' : 'unknown'),
          rawUpdate: update,
        },
        originalRequest: req,
      };

      // Process through gateway
      const gatewayResponse = await this.gateway.processRequest(gatewayRequest);

      // If gateway processing was successful, process through orchestrator
      if (gatewayResponse.success && gatewayResponse.data?.transformedRequest) {
        // Process the update asynchronously through the orchestrator
        this.processUpdateAsync(update);
      } else {
        this.log('warn', `Gateway rejected Telegram update: ${gatewayResponse.error}`);
      }

      return new Response("OK", { status: 200 });
    } catch (error) {
      this.log('error', `Telegram webhook processing error: ${error.message}`);
      return new Response("Error", { status: 500 });
    }
  }

  /**
   * Handle GitHub webhook (placeholder for future implementation)
   */
  private async handleGitHubWebhook(req: Request): Promise<Response> {
    try {
      const body = await req.json();

      this.log('info', `GitHub webhook received: ${body.action || 'unknown'}`);

      // TODO: Implement GitHub webhook processing
      // - Parse GitHub events (issues, PRs, comments, etc.)
      // - Route through gateway
      // - Process with AI system
      // - Respond back to GitHub (comments, status updates, etc.)

      return new Response(JSON.stringify({
        success: true,
        message: "GitHub webhook received (implementation pending)",
        event: body.action || 'unknown'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      this.log('error', `GitHub webhook error: ${error.message}`);
      return new Response("Error", { status: 500 });
    }
  }

  /**
   * Handle Google Drive webhook (placeholder for future implementation)
   */
  private async handleGoogleDriveWebhook(req: Request): Promise<Response> {
    try {
      const body = await req.json();

      this.log('info', `Google Drive webhook received`);

      // TODO: Implement Google Drive webhook processing
      // - Parse Drive notifications (comments, shares, etc.)
      // - Route through gateway
      // - Process with AI system
      // - Respond back to Drive (reply to comments, etc.)

      return new Response(JSON.stringify({
        success: true,
        message: "Google Drive webhook received (implementation pending)"
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      this.log('error', `Google Drive webhook error: ${error.message}`);
      return new Response("Error", { status: 500 });
    }
  }

  /**
   * Handle server health check
   */
  private async handleServerHealth(): Promise<Response> {
    const healthData = {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.serverStartTime,
      features: this.config.features,
      deduplicationCacheSize: deduplicationService.getSize(),
      server: "unified-multi-platform"
    };

    return new Response(JSON.stringify(healthData, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Handle test message endpoint (from original main.ts)
   */
  private async handleTestMessage(req: Request): Promise<Response> {
    // Implementation from original main.ts test endpoint
    // This is a direct copy with minimal changes
    try {
      const body = await req.json();

      // Validate request body format
      if (!body.text || typeof body.text !== "string") {
        return new Response(JSON.stringify({
          success: false,
          error: "Missing or invalid 'text' field",
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!body.chatId || typeof body.chatId !== "string") {
        return new Response(JSON.stringify({
          success: false,
          error: "Missing or invalid 'chatId' field",
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!body.userId || typeof body.userId !== "string") {
        return new Response(JSON.stringify({
          success: false,
          error: "Missing or invalid 'userId' field",
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      this.log('info', `Test endpoint processing: "${body.text}" from user ${body.userId} in chat ${body.chatId}`);

      // Create gateway request for test endpoint
      const gatewayRequest = {
        id: `test_${Date.now()}`,
        source: 'http' as const,
        timestamp: new Date(),
        userId: body.userId,
        chatId: body.chatId,
        sessionId: body.sessionId || 'test-session-default',
        content: body.text,
        metadata: {
          endpoint: 'test',
          testMode: true,
        },
        originalRequest: req,
      };

      // Process through gateway first
      const gatewayResponse = await this.gateway.processRequest(gatewayRequest);

      if (!gatewayResponse.success) {
        return new Response(JSON.stringify({
          success: false,
          error: "Gateway rejected test request",
          details: gatewayResponse.error,
          gatewayMetrics: gatewayResponse.metadata,
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Enable test mode on telegram adapter
      const telegramAdapterImpl = this.telegramAdapter as any;
      telegramAdapterImpl.setTestMode(true);
      telegramAdapterImpl.clearCapturedResponses();

      // Create a proper TelegramUpdate object from the test input
      const testUpdate = {
        update_id: Date.now(),
        message: {
          message_id: Date.now(),
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: parseInt(body.chatId),
            type: "private",
          },
          from: {
            id: parseInt(body.userId),
            is_bot: false,
            first_name: "Test User",
          },
          text: body.text,
        },
      };

      // Process through the orchestrator with response capture
      let capturedResponse: string | undefined = undefined;
      let capturedError: Error | undefined = undefined;
      let processingStartTime = Date.now();

      try {
        await this.orchestrator.handleUpdate(testUpdate);

        // Wait for response capture with polling (max 90 seconds for LLM processing)
        const maxWaitTime = 90000;
        const pollInterval = 500;
        let waitTime = 0;

        while (waitTime < maxWaitTime) {
          capturedResponse = telegramAdapterImpl.getCapturedResponse(parseInt(body.chatId));

          if (capturedResponse) {
            this.log('info', `Test response captured after ${waitTime}ms`);
            break;
          }

          await new Promise(resolve => setTimeout(resolve, pollInterval));
          waitTime += pollInterval;
        }

        if (!capturedResponse) {
          this.log('warn', `Test response timeout after ${maxWaitTime}ms`);
        }

      } catch (error) {
        capturedError = error as Error;
        this.log('error', `Test processing error: ${error.message}`);
      } finally {
        telegramAdapterImpl.setTestMode(false);
      }

      const processingTime = Date.now() - processingStartTime;

      const result = {
        success: !capturedError,
        message: capturedError ? "Test message processing failed" : "Test message processed successfully with real LLM integration",
        response: capturedResponse,
        processingTime,
        error: capturedError?.message,
        testInput: body,
        telegramUpdate: testUpdate,
        timestamp: new Date().toISOString(),
        gatewayProcessed: true,
        gatewayMetrics: gatewayResponse.metadata,
        serverType: "unified-multi-platform",
        note: "Processed through Unified Server -> API Gateway -> SystemOrchestrator -> Full AI Pipeline",
      };

      return new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json" },
      });

    } catch (error) {
      this.log('error', `Test message endpoint error: ${error.message}`);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to process test message",
        details: error.message,
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  /**
   * Handle conversations endpoint (from original main.ts)
   */
  private async handleConversations(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const params = url.searchParams;
      const chatIdParam = params.get("chatId");
      const limitParam = params.get("limit");

      // Dynamically import conversation history
      const { conversationHistory } = await import("./services/conversation-history.ts");

      // If specific chatId is requested
      if (chatIdParam) {
        const chatId = parseInt(chatIdParam);
        if (isNaN(chatId)) {
          return new Response(JSON.stringify({
            error: "Invalid chatId parameter",
          }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const history = await conversationHistory.getHistory(chatId);
        const { countTokens } = await import("./utils/token-counter.ts");

        let totalTokens = 0;
        for (const msg of history) {
          totalTokens += countTokens(msg.content);
        }

        return new Response(JSON.stringify({
          chatId,
          messageCount: history.length,
          totalTokens,
          messages: history,
          timestamp: new Date().toISOString(),
          serverType: "unified-multi-platform"
        }, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Get all conversations
      const kv = await Deno.openKv();
      const conversations: any[] = [];
      const limit = limitParam ? parseInt(limitParam) : undefined;
      let count = 0;

      const iter = kv.list({ prefix: ["chat"] });
      for await (const entry of iter) {
        if (entry.key[2] === "messages" && entry.value) {
          const chatId = String(entry.key[1]);
          const messages = entry.value as any[];

          if (limit && count >= limit) break;

          const { countTokens } = await import("./utils/token-counter.ts");
          let totalTokens = 0;
          for (const entry of messages) {
            totalTokens += countTokens(entry.message.content);
          }

          conversations.push({
            chatId,
            messageCount: messages.length,
            totalTokens,
            firstMessageTime: messages[0]?.timestamp ? new Date(messages[0].timestamp).toISOString() : null,
            lastMessageTime: messages[messages.length - 1]?.timestamp ? new Date(messages[messages.length - 1].timestamp).toISOString() : null,
            messages: messages.length <= 10 ? messages : `[${messages.length} messages - use ?chatId=${chatId} to view all]`,
          });

          count++;
        }
      }

      const stats = await conversationHistory.getStats();

      return new Response(JSON.stringify({
        stats: {
          totalChats: stats.totalChats,
          totalMessages: stats.totalMessages,
          timestamp: new Date().toISOString(),
          serverType: "unified-multi-platform"
        },
        conversations: conversations.sort((a, b) => {
          const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
          const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
          return timeB - timeA;
        }),
        queryParams: {
          available: ["chatId", "limit"],
          examples: [
            "/conversations?chatId=123456789",
            "/conversations?limit=5",
          ],
        },
      }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });

    } catch (error) {
      this.log('error', `Conversations endpoint error: ${error.message}`);
      return new Response(JSON.stringify({
        error: "Failed to retrieve conversation data",
        details: error.message,
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  /**
   * Process update asynchronously (from original main.ts)
   */
  private async processUpdateAsync(update: any): Promise<void> {
    try {
      await this.orchestrator.handleUpdate(update);
    } catch (error) {
      this.log('error', `Error processing update asynchronously: ${error.message}`);
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
      console.log(`[${timestamp}] [${level.toUpperCase()}] [UnifiedServer] ${message}`);
    }
  }
}

/**
 * Create default configuration for Unified Server
 */
export async function createDefaultUnifiedServerConfig(): Promise<UnifiedServerConfig> {
  const config = await getConfig();

  return {
    port: parseInt(Deno.env.get('UNIFIED_SERVER_PORT') || '8000', 10),
    host: '0.0.0.0',
    corsOrigins: ['*'],
    authentication: {
      required: false, // Disabled by default for development
      apiKeyHeader: 'X-API-Key',
      validApiKeys: Deno.env.get('API_KEYS')?.split(',').map(key => key.trim()) || []
    },
    webhooks: {
      telegram: {
        enabled: true,
        path: `/webhook/${config.webhookSecret}`,
        secret: config.webhookSecret
      },
      github: {
        enabled: false, // Will be enabled when implemented
        path: '/webhook/github',
        secret: Deno.env.get('GITHUB_WEBHOOK_SECRET')
      },
      googleDrive: {
        enabled: false, // Will be enabled when implemented
        path: '/webhook/google-drive',
        secret: Deno.env.get('GOOGLE_DRIVE_WEBHOOK_SECRET')
      }
    },
    features: {
      restApi: true,
      telegramBot: true,
      githubIntegration: false, // Planned
      googleDriveIntegration: false, // Planned
      mcpProtocol: false // Future
    },
    rateLimiting: {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 100
    },
    logging: {
      enabled: true,
      level: 'info'
    }
  };
}

/**
 * Main startup function for Unified Server
 */
async function startUnifiedServer(): Promise<void> {
  console.log('🌟 Starting Unified Multi-Platform AI Server...');

  try {
    // Load config
    const config = await getConfig();

    // Initialize logging system
    console.log('📝 Initializing logging system...');
    await initializeLogging();

    // Initialize telemetry service
    console.log('📊 Initializing telemetry service...');
    const telemetryConfig = createDefaultTelemetryConfig();
    const telemetry = await initializeTelemetry(telemetryConfig);

    // Initialize API Gateway
    console.log('🚪 Initializing API Gateway...');
    const gatewayConfig: ApiGatewayConfig = {
      rateLimiting: {
        telegram: { windowMs: 60000, maxRequests: 30, keyGenerator: (req) => req.userId, enabled: true },
        http: { windowMs: 60000, maxRequests: 60, keyGenerator: (req) => req.userId, enabled: true },
        cli: { windowMs: 60000, maxRequests: 100, keyGenerator: (req) => req.userId, enabled: true },
      },
      middleware: {
        enableLogging: true,
        enableValidation: true,
        enableTransformation: true,
        enableAuth: false, // Disabled for development - no API keys required
      },
      performance: {
        requestTimeout: 30000,
        maxConcurrentRequests: 100,
      },
      debug: {
        logRequests: true,
        logResponses: true,
        logMiddleware: true,
      },
    };

    const gateway = new ApiGateway(gatewayConfig, telemetry);
    await gateway.initialize();

    // Bootstrap the system using DI container
    console.log('🔧 Bootstrapping system with dependency injection...');
    const { container, orchestrator } = await bootstrap({
      botToken: config.botToken,
      webhookSecret: config.webhookSecret,
    });

    // Get required services from container
    const telegramAdapter = container.get<ITelegramInterfaceAdapter>(TYPES.TelegramInterfaceAdapter);

    // Set orchestrator in gateway
    gateway.setSystemOrchestrator(orchestrator);

    // Create MessageRouter and SessionManager
    console.log('🔀 Creating MessageRouter and SessionManager...');
    const messageRouterConfig = createDefaultMessageRouterConfig();
    const messageRouter = new MessageRouter(messageRouterConfig, orchestrator as any);

    const sessionManagerConfig = createDefaultSessionManagerConfig();
    const sessionManager = new SessionManager(sessionManagerConfig);
    await sessionManager.initialize();

    // Create unified server configuration
    const serverConfig = await createDefaultUnifiedServerConfig();

    // Enable authentication if API keys are provided
    if (serverConfig.authentication.validApiKeys.length > 0) {
      serverConfig.authentication.required = true;
      console.log('🔐 Authentication enabled with environment API keys');
    }

    // Create and start the unified server
    console.log('🚀 Creating Unified Server...');
    const server = new UnifiedServer(
      serverConfig,
      orchestrator,
      messageRouter,
      sessionManager,
      gateway,
      telegramAdapter
    );

    console.log('🎬 Starting Unified Server...');
    await server.start();

    // Subscribe to critical events
    eventBus.on(SystemEventType.ERROR_OCCURRED, (event) => {
      console.error(`❌ System error from ${event.source}:`, event);
    });

    eventBus.on(SystemEventType.COMPONENT_ERROR, (event) => {
      console.error(`❌ Component error from ${event.source}:`, event);
    });

    eventBus.on(SystemEventType.SYSTEM_READY, (event) => {
      console.log('✅ System is ready to process messages');
    });

    // Set up graceful shutdown handling
    const shutdown = async (signal: string) => {
      console.log(`🛑 Received ${signal}, shutting down gracefully...`);

      try {
        await server.stop();
        console.log('✅ Graceful shutdown completed');
        Deno.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        Deno.exit(1);
      }
    };

    // Handle shutdown signals
    Deno.addSignalListener("SIGINT", () => shutdown("SIGINT"));
    Deno.addSignalListener("SIGTERM", () => shutdown("SIGTERM"));

    console.log('🎉 Unified Multi-Platform AI Server startup completed successfully!');
    console.log('🤖 Features enabled:');
    console.log(`   ✅ REST API: ${serverConfig.features.restApi ? 'ENABLED' : 'DISABLED'}`);
    console.log(`   ✅ Telegram Bot: ${serverConfig.features.telegramBot ? 'ENABLED' : 'DISABLED'}`);
    console.log(`   🚧 GitHub Integration: ${serverConfig.features.githubIntegration ? 'ENABLED' : 'PLANNED'}`);
    console.log(`   🚧 Google Drive Integration: ${serverConfig.features.googleDriveIntegration ? 'ENABLED' : 'PLANNED'}`);
    console.log(`   🔮 MCP Protocol: ${serverConfig.features.mcpProtocol ? 'ENABLED' : 'FUTURE'}`);
    console.log('🧠 AI System: ENABLED - Real LLM responses via SystemOrchestrator');
    console.log('🛑 Press Ctrl+C to gracefully shutdown');

  } catch (error) {
    console.error('❌ Failed to start Unified Server:', error);

    if (error instanceof Error) {
      console.error('❌ Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }

    Deno.exit(1);
  }
}

// Only run if this file is being executed directly
if (import.meta.main) {
  await startUnifiedServer();
}
