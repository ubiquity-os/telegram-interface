/**
 * API Server Startup Script
 *
 * Minimal startup for Phase 1 - bypasses complex SystemOrchestrator
 */

import { CoreApiServer, createDefaultCoreApiServerConfig } from './api-server.ts';
import { MessageRouter, createDefaultMessageRouterConfig } from './message-router.ts';
import { SessionManager, createDefaultSessionManagerConfig } from './session-manager.ts';

/**
 * Create a minimal mock SystemOrchestrator for Phase 1
 */
class MockSystemOrchestrator {
  async handleUpdate(update: any): Promise<void> {
    console.log('[MockSystemOrchestrator] Processing update:', JSON.stringify(update, null, 2));
    // For Phase 1, just log the message - no actual processing
    // This will be replaced with real SystemOrchestrator in Phase 2
  }

  getComponent<T>(componentName: string): T | null {
    console.log(`[MockSystemOrchestrator] Component requested: ${componentName}`);
    // Return null for now - tools endpoint will return empty array
    return null;
  }

  async shutdown(): Promise<void> {
    console.log('[MockSystemOrchestrator] Mock shutdown completed');
  }
}

/**
 * Main startup function
 */
async function startApiServer(): Promise<void> {
  console.log('[StartupScript] Starting Core API Server (Phase 1 - Minimal Mode)...');

  try {
    // Create mock SystemOrchestrator for Phase 1
    console.log('[StartupScript] Creating MockSystemOrchestrator...');
    const mockSystemOrchestrator = new MockSystemOrchestrator();

    // Create MessageRouter with mock orchestrator
    console.log('[StartupScript] Creating MessageRouter...');
    const messageRouterConfig = createDefaultMessageRouterConfig();
    const messageRouter = new MessageRouter(messageRouterConfig, mockSystemOrchestrator as any);

    // Create SessionManager
    console.log('[StartupScript] Creating SessionManager...');
    const sessionManagerConfig = createDefaultSessionManagerConfig();
    const sessionManager = new SessionManager(sessionManagerConfig);
    await sessionManager.initialize();

    // Create CoreApiServer configuration
    console.log('[StartupScript] Creating CoreApiServer...');
    const apiServerConfig = createDefaultCoreApiServerConfig();

    // Override authentication for development (disable by default)
    apiServerConfig.authentication.required = false;
    console.log('[StartupScript] Authentication disabled for Phase 1 development');

    // Set environment-based API keys if available
    const apiKeysEnv = Deno.env.get('API_KEYS');
    if (apiKeysEnv) {
      apiServerConfig.authentication.validApiKeys = apiKeysEnv.split(',').map(key => key.trim());
      apiServerConfig.authentication.required = true;
      console.log('[StartupScript] Authentication enabled with environment API keys');
    }

    // Override port if specified in environment
    const portEnv = Deno.env.get('API_SERVER_PORT');
    if (portEnv) {
      const port = parseInt(portEnv, 10);
      if (!isNaN(port) && port > 0 && port <= 65535) {
        apiServerConfig.port = port;
        console.log(`[StartupScript] Using custom port from environment: ${port}`);
      }
    }

    console.log(`[StartupScript] API Server will listen on ${apiServerConfig.host}:${apiServerConfig.port}`);

    // Create and start the API server
    const apiServer = new CoreApiServer(apiServerConfig, messageRouter, sessionManager);

    console.log('[StartupScript] Starting API Server...');
    await apiServer.start();

    // Set up graceful shutdown handling
    const shutdown = async (signal: string) => {
      console.log(`[StartupScript] Received ${signal}, shutting down gracefully...`);

      try {
        await apiServer.stop();
        await sessionManager.shutdown();
        await mockSystemOrchestrator.shutdown();
        console.log('[StartupScript] Graceful shutdown completed');
        Deno.exit(0);
      } catch (error) {
        console.error('[StartupScript] Error during shutdown:', error);
        Deno.exit(1);
      }
    };

    // Handle shutdown signals
    Deno.addSignalListener("SIGINT", () => shutdown("SIGINT"));
    Deno.addSignalListener("SIGTERM", () => shutdown("SIGTERM"));

    console.log('[StartupScript] ✅ API Server startup completed successfully');
    console.log('[StartupScript] 🚀 Server is ready to accept requests');
    console.log('[StartupScript] 📚 Available endpoints:');
    console.log('[StartupScript]   - GET  /api/v1/health');
    console.log('[StartupScript]   - POST /api/v1/messages');
    console.log('[StartupScript]   - POST /api/v1/sessions');
    console.log('[StartupScript]   - GET  /api/v1/sessions/:id');
    console.log('[StartupScript]   - GET  /api/v1/tools');
    console.log('[StartupScript] 🛑 Press Ctrl+C to gracefully shutdown');

  } catch (error) {
    console.error('[StartupScript] ❌ Failed to start API Server:', error);

    // Log more details for debugging
    if (error instanceof Error) {
      console.error('[StartupScript] Error details:', {
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
  console.log('[StartupScript] 🌟 Core API Server startup script starting...');
  console.log('[StartupScript] 📝 Phase 1: Platform-agnostic API layer');
  await startApiServer();
}